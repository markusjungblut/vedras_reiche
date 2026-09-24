import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

import { AccountError, AccountManager, FileAccountStore } from "../dist/account-store.js";
import { CryptoCardSource } from "../dist/random.js";
import { RoomManager } from "../dist/room-manager.js";
import { createVedrasServer } from "../dist/server.js";
import { NetworkErrorCode } from "@vedras/protocol";

class FixedRandomSource {
  nextInt(min) { return min; }
}

class TestRoomStore {
  constructor() { this.rooms = new Map(); }
  async loadAll() { return [...this.rooms.values()].map((room) => JSON.parse(JSON.stringify(room))); }
  async load(roomId) { const room = this.rooms.get(roomId); return room === undefined ? undefined : JSON.parse(JSON.stringify(room)); }
  async save(room) { this.rooms.set(room.roomId, JSON.parse(JSON.stringify(room))); }
  async delete(roomId) { this.rooms.delete(roomId); }
}

function roomManager(roomStore = new TestRoomStore(), initial = {}) {
  let room = initial.room ?? 0;
  let player = initial.player ?? 0;
  let token = initial.token ?? 0;
  return new RoomManager({
    randomSource: new FixedRandomSource(),
    cardSource: new CryptoCardSource(),
    roomStore,
    now: () => "2026-09-24T12:00:00.000Z",
    roomIdFactory: () => "ROOM" + (++room),
    playerIdFactory: () => "P" + (++player),
    sessionTokenFactory: () => "room-token-" + (++token),
  });
}

function accountManager(options = {}) {
  let account = 0;
  let token = 0;
  return new AccountManager({
    accountIdFactory: () => "account-" + (++account),
    sessionTokenFactory: () => "account-token-" + (++token),
    ...options,
  });
}

function setCookieFrom(response) {
  const value = response.headers.get("set-cookie");
  if (value === null) throw new Error("Account cookie missing.");
  return value;
}

function cookieFrom(response) {
  return setCookieFrom(response).split(";", 1)[0];
}

async function requestJson(base, path, options = {}) {
  const response = await fetch(base + path, options);
  return { response, payload: await response.json() };
}

async function register(base, username, displayName) {
  const result = await requestJson(base, "/api/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName, password: "ein-sicheres-passwort" }),
  });
  assert.equal(result.response.status, 201);
  return { account: result.payload, cookie: cookieFrom(result.response), setCookie: setCookieFrom(result.response) };
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

test("accounts normalize names, keep credentials private, and survive a store restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vedras-accounts-"));
  try {
    const store = new FileAccountStore(join(directory, "accounts"));
    await store.ensureReady();
    const accountsA = accountManager({ store });
    await accountsA.restore();
    const registered = await accountsA.register("  AnNa  ", "", "ein-sicheres-passwort");
    assert.deepEqual(registered.account, { id: "account-1", username: "AnNa", displayName: "AnNa" });
    assert.equal(JSON.stringify(registered.account).includes("password"), false);
    await assert.rejects(() => accountsA.register("anna", "Andere Anna", "ein-sicheres-passwort"),
      (error) => error instanceof AccountError && error.code === "USERNAME_TAKEN");
    await assert.rejects(() => accountsA.login("anna", "falsches-passwort"),
      (error) => error instanceof AccountError && error.code === "INVALID_CREDENTIALS");

    const persisted = await readFile(join(directory, "accounts", "accounts.json"), "utf8");
    assert.equal(persisted.includes(registered.sessionToken), false);
    assert.equal(persisted.includes("ein-sicheres-passwort"), false);
    assert.equal(persisted.includes("passwordHash"), true);

    const accountsB = accountManager({ store, sessionTokenFactory: () => "account-token-after-restart" });
    await accountsB.restore();
    const loggedIn = await accountsB.login("ANNA", "ein-sicheres-passwort");
    assert.deepEqual(await accountsB.resolveSession(loggedIn.sessionToken), registered.account);
    await accountsB.logout(loggedIn.sessionToken);
    assert.equal(await accountsB.resolveSession(loggedIn.sessionToken), undefined);

    const accountsC = accountManager({ store });
    await accountsC.restore();
    assert.equal(await accountsC.resolveSession(loggedIn.sessionToken), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("account rooms rejoin with the same participant, protect host authority, and replace prior sockets", async () => {
  const rooms = roomManager();
  const accounts = accountManager();
  await accounts.restore();
  const server = createVedrasServer({ roomManager: rooms, accountManager: accounts, port: 0, production: true, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = "http://127.0.0.1:" + server.port;
  let firstSocket;
  let secondSocket;
  try {
    const host = await register(base, "anna-account", "Anna");
    // Display names are presentation only: a second account with the same name still receives its own participant.
    const guest = await register(base, "ben-account", "Anna");
    assert.match(host.setCookie, /HttpOnly/);
    assert.match(host.setCookie, /SameSite=Lax/);
    assert.match(host.setCookie, /Path=\//);
    assert.match(host.setCookie, /Secure/);

    const created = await requestJson(base, "/api/rooms", {
      method: "POST", headers: { "content-type": "application/json", cookie: host.cookie }, body: "{}",
    });
    assert.equal(created.response.status, 201);
    assert.equal(JSON.stringify(created.payload).includes("account-token"), false);

    const joined = await requestJson(base, `/api/rooms/${created.payload.roomId}/join`, {
      method: "POST", headers: { "content-type": "application/json", cookie: guest.cookie }, body: "{}",
    });
    assert.equal(joined.response.status, 201);
    assert.equal(rooms.getRoom(created.payload.roomId).participants.size, 2);

    const firstToken = created.payload.sessionToken;
    firstSocket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws", { headers: { cookie: host.cookie } });
    await once(firstSocket, "open");
    const firstSnapshot = waitForMessage(firstSocket, (message) => message.type === "ROOM_SNAPSHOT");
    firstSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: created.payload.roomId, sessionToken: firstToken }));
    await firstSnapshot;

    const resumed = await requestJson(base, `/api/rooms/${created.payload.roomId}/join`, {
      method: "POST", headers: { "content-type": "application/json", cookie: host.cookie }, body: "{}",
    });
    assert.equal(resumed.response.status, 200);
    assert.equal(resumed.payload.playerId, created.payload.playerId);
    assert.notEqual(resumed.payload.sessionToken, firstToken);
    assert.equal(rooms.getRoom(created.payload.roomId).participants.size, 2);
    assert.equal(rooms.getRoom(created.payload.roomId).participants.get(created.payload.playerId).accountId, host.account.id);
    assert.throws(() => rooms.authenticate(created.payload.roomId, firstToken), (error) => error.code === NetworkErrorCode.InvalidSession);

    const oldCommandRejected = waitForMessage(firstSocket, (message) => message.type === "SERVER_ERROR" && message.code === NetworkErrorCode.InvalidSession);
    firstSocket.send(JSON.stringify({ type: "GAME_COMMAND", commandId: "stale-token", action: { type: "PASS_ACTION" } }));
    await oldCommandRejected;

    const replacement = waitForMessage(firstSocket, (message) => message.type === "SERVER_ERROR" && message.code === NetworkErrorCode.SessionReplaced);
    secondSocket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws", { headers: { cookie: host.cookie } });
    await once(secondSocket, "open");
    const secondSnapshot = waitForMessage(secondSocket, (message) => message.type === "ROOM_SNAPSHOT");
    secondSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: created.payload.roomId, sessionToken: resumed.payload.sessionToken }));
    await Promise.all([replacement, secondSnapshot]);

    const roomsForHost = await requestJson(base, "/api/me/rooms", { headers: { cookie: host.cookie } });
    assert.equal(roomsForHost.response.status, 200);
    assert.deepEqual(roomsForHost.payload.rooms.map((room) => room.roomId), [created.payload.roomId]);
    assert.equal(roomsForHost.payload.rooms[0].playerId, created.payload.playerId);

    const guestStart = await requestJson(base, `/api/rooms/${created.payload.roomId}/start`, {
      method: "POST", headers: { "content-type": "application/json", cookie: guest.cookie },
      body: JSON.stringify({ sessionToken: joined.payload.sessionToken, playerOrder: [created.payload.playerId, joined.payload.playerId], firstMapDrawerPlayerId: created.payload.playerId }),
    });
    assert.equal(guestStart.response.status, 403);
    assert.equal(guestStart.payload.code, NetworkErrorCode.NotHost);

    const foreignToken = await requestJson(base, `/api/rooms/${created.payload.roomId}/start`, {
      method: "POST", headers: { "content-type": "application/json", cookie: guest.cookie },
      body: JSON.stringify({ sessionToken: resumed.payload.sessionToken, playerOrder: [created.payload.playerId, joined.payload.playerId], firstMapDrawerPlayerId: created.payload.playerId }),
    });
    assert.equal(foreignToken.response.status, 401);
    assert.equal(foreignToken.payload.code, NetworkErrorCode.AuthenticationRequired);

    const source = rooms.getRoom(created.payload.roomId);
    source.status = "FINISHED";
    const rematch = await rooms.createRematch(source.roomId, resumed.payload.sessionToken);
    assert.notEqual(rematch.participant.playerId, created.payload.playerId);
    assert.equal(rematch.participant.accountId, host.account.id);

    const logout = await requestJson(base, "/api/auth/logout", { method: "POST", headers: { cookie: host.cookie } });
    assert.equal(logout.response.status, 200);
    const meAfterLogout = await requestJson(base, "/api/auth/me", { headers: { cookie: host.cookie } });
    assert.equal(meAfterLogout.response.status, 401);
  } finally {
    firstSocket?.close();
    secondSocket?.close();
    await server.close();
  }
});

test("legacy room snapshots keep their participants unlinked to an account name", async () => {
  const store = new TestRoomStore();
  const roomsA = roomManager(store);
  const legacy = await roomsA.createRoom("Anna");
  const snapshot = await store.load(legacy.room.roomId);
  await store.save({ ...snapshot, persistenceVersion: 1 });

  const roomsB = roomManager(store, { room: 1, player: 1, token: 1 });
  await roomsB.restore();
  const restored = roomsB.getRoom(legacy.room.roomId);
  assert.equal(restored.participants.get(legacy.participant.playerId).accountId, undefined);
  const accountJoin = await roomsB.joinRoom(legacy.room.roomId, "Anna", "account-anna");
  assert.notEqual(accountJoin.participant.playerId, legacy.participant.playerId);
  assert.equal(restored.participants.size, 2);
});

test("login attempts are rate-limited per client address", async () => {
  const accounts = accountManager();
  await accounts.restore();
  const server = createVedrasServer({ roomManager: roomManager(), accountManager: accounts, port: 0, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = "http://127.0.0.1:" + server.port;
  try {
    await register(base, "rate-limit", "Rate Limit");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await requestJson(base, "/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rate-limit", password: "falsch" }),
      });
      assert.equal(result.response.status, 401);
      assert.equal(result.payload.code, NetworkErrorCode.InvalidCredentials);
    }
    const throttled = await requestJson(base, "/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "rate-limit", password: "falsch" }),
    });
    assert.equal(throttled.response.status, 429);
    assert.equal(throttled.payload.code, NetworkErrorCode.TooManyRequests);
  } finally {
    await server.close();
  }
});
