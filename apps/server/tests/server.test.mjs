import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

import { CryptoCardSource } from "../dist/random.js";
import { RoomError, RoomManager } from "../dist/room-manager.js";
import { FileRoomStore } from "../dist/room-store.js";
import { broadcastRoom, createVedrasServer } from "../dist/server.js";
import { GameActionType, GamePhase, Suit, createGameState } from "@vedras/game-core";
import { MAX_MAP_CELLS, MAX_MAP_HEIGHT, MAX_MAP_WIDTH, MAX_WEBSOCKET_PAYLOAD_BYTES, NetworkErrorCode } from "@vedras/protocol";

class FixedRandomSource {
  nextInt(min) { return min; }
}

class TestRoomStore {
  constructor() { this.rooms = new Map(); this.failSaves = false; }
  async loadAll() { return [...this.rooms.values()].map((room) => JSON.parse(JSON.stringify(room))); }
  async load(roomId) { const room = this.rooms.get(roomId); return room === undefined ? undefined : JSON.parse(JSON.stringify(room)); }
  async save(room) {
    if (this.failSaves) throw new Error("disk unavailable");
    this.rooms.set(room.roomId, JSON.parse(JSON.stringify(room)));
  }
  async delete(roomId) { this.rooms.delete(roomId); }
}

function manager(roomStore = new TestRoomStore()) {
  let room = 0;
  let player = 0;
  let token = 0;
  return new RoomManager({
    randomSource: new FixedRandomSource(),
    cardSource: new CryptoCardSource(),
    roomStore,
    now: () => "2026-09-22T12:00:00.000Z",
    roomIdFactory: () => "ROOM" + (++room),
    playerIdFactory: () => "P" + (++player),
    sessionTokenFactory: () => "token-" + (++token),
  });
}

async function startTwoPlayers(roomManager) {
  const host = await roomManager.createRoom("Anna");
  const guest = await roomManager.joinRoom(host.room.roomId, "Ben");
  await roomManager.startRoom(host.room.roomId, host.sessionToken,
    [host.participant.playerId, guest.participant.playerId], host.participant.playerId);
  return { ...host, guest, annaToken: host.sessionToken, guestToken: guest.sessionToken };
}

function vertical(cut) {
  return Array.from({ length: 50 }, (_, y) => ({ from: { x: cut - 1, y }, to: { x: cut, y } }));
}

test("room lifecycle preserves host authority and lobby configuration", async () => {
  const rooms = manager();
  const host = await rooms.createRoom("Anna");
  assert.equal(host.room.status, "WAITING");
  await assert.rejects(() => rooms.startRoom(host.room.roomId, host.sessionToken, [host.participant.playerId], host.participant.playerId),
    (error) => error.code === NetworkErrorCode.InvalidStartConfiguration);

  const guest = await rooms.joinRoom(host.room.roomId, "Ben");
  await assert.rejects(() => rooms.updateMap(host.room.roomId, guest.sessionToken, { width: 100, height: 50 }),
    (error) => error.code === NetworkErrorCode.NotHost);
  await rooms.updateMap(host.room.roomId, host.sessionToken, { width: 100, height: 50 });
  await rooms.startRoom(host.room.roomId, host.sessionToken,
    [host.participant.playerId, guest.participant.playerId], host.participant.playerId);
  assert.equal(host.room.status, "RUNNING");
  assert.equal(host.room.gameState.map.width, 100);
});

test("technical map limits reject oversized lobby configurations without changing the room", async () => {
  const rooms = manager();
  const host = await rooms.createRoom("Anna");
  const original = { ...host.room.map };
  await assert.rejects(() => rooms.updateMap(host.room.roomId, host.sessionToken, { width: MAX_MAP_WIDTH + 1, height: 50 }),
    (error) => error.code === NetworkErrorCode.InvalidStartConfiguration);
  await assert.rejects(() => rooms.updateMap(host.room.roomId, host.sessionToken, { width: MAX_MAP_WIDTH, height: MAX_MAP_HEIGHT }),
    (error) => error.code === NetworkErrorCode.InvalidStartConfiguration && MAX_MAP_WIDTH * MAX_MAP_HEIGHT > MAX_MAP_CELLS);
  assert.deepEqual(host.room.map, original);
});

test("commands are serialized, identity-bound, and keep only a durable idempotency window", async () => {
  const rooms = manager();
  const { room, participant: anna, guest, annaToken, guestToken } = await startTwoPlayers(rooms);
  const revision = room.revision;
  const impersonation = await rooms.processCommand(room.roomId, annaToken, "impersonate", {
    type: GameActionType.CommitSetupBoundaryDraft, playerId: guest.participant.playerId, edges: vertical(25),
  });
  assert.equal(impersonation.accepted, false);
  const accepted = await rooms.processCommand(room.roomId, annaToken, "split-once", {
    type: GameActionType.CommitSetupBoundaryDraft, playerId: anna.playerId, edges: vertical(25),
  });
  assert.equal(accepted.accepted, true);
  assert.equal(room.revision, revision + 1);
  assert.equal(room.gameState.mapCreation.regionCount, 2);
  const duplicate = await rooms.processCommand(room.roomId, annaToken, "split-once", {
    type: GameActionType.CommitSetupBoundaryDraft, playerId: anna.playerId, edges: vertical(25),
  });
  assert.deepEqual({ accepted: duplicate.accepted, duplicate: duplicate.duplicate, revision: duplicate.revision },
    { accepted: true, duplicate: true, revision: revision + 1 });
  assert.equal(room.revision, revision + 1);
  const inactive = await rooms.processCommand(room.roomId, guestToken, "guest-split", {
    type: GameActionType.CommitSetupBoundaryDraft, playerId: guest.participant.playerId, edges: vertical(25),
  });
  assert.equal(inactive.accepted, false);
});

test("file snapshots restore waiting and running rooms without raw session tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vedras-rooms-"));
  try {
    const store = new FileRoomStore(join(directory, "rooms"));
    const roomsA = manager(store);
    const waiting = await roomsA.createRoom("Clara");
    const { room, participant: anna, annaToken } = await startTwoPlayers(roomsA);
    const accepted = await roomsA.processCommand(room.roomId, annaToken, "midline", {
      type: GameActionType.CommitSetupBoundaryDraft, playerId: anna.playerId, edges: vertical(25),
    });
    assert.equal(accepted.accepted, true);
    const persisted = await readFile(join(directory, "rooms", `${room.roomId}.json`), "utf8");
    assert.equal(persisted.includes(annaToken), false);
    assert.equal(persisted.includes("sessionTokenHash"), true);
    await writeFile(join(directory, "rooms", "BROKEN.json"), "{not valid JSON", "utf8");

    const roomsB = manager(store);
    const restored = await roomsB.restore();
    assert.equal(restored.loaded, 2);
    assert.equal(restored.skipped, 1);
    assert.equal(roomsB.getRoom(waiting.room.roomId).status, "WAITING");
    const running = roomsB.getRoom(room.roomId);
    assert.equal(running.revision, room.revision);
    assert.equal(running.gameState.mapCreation.regionCount, 2);
    assert.equal(roomsB.getPublicRoomState(running).players.every((player) => !player.connected), true);
    assert.equal(roomsB.authenticate(room.roomId, annaToken).participant.playerId, anna.playerId);
    const duplicate = await roomsB.processCommand(room.roomId, annaToken, "midline", {
      type: GameActionType.CommitSetupBoundaryDraft, playerId: anna.playerId, edges: vertical(25),
    });
    assert.deepEqual({ accepted: duplicate.accepted, duplicate: duplicate.duplicate, revision: duplicate.revision },
      { accepted: true, duplicate: true, revision: room.revision });
    assert.equal(running.revision, room.revision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed durable save keeps the previous authoritative state and revision", async () => {
  const store = new TestRoomStore();
  const rooms = manager(store);
  const { room, participant: anna, annaToken } = await startTwoPlayers(rooms);
  const revision = room.revision;
  store.failSaves = true;
  await assert.rejects(() => rooms.processCommand(room.roomId, annaToken, "will-not-commit", {
    type: GameActionType.CommitSetupBoundaryDraft, playerId: anna.playerId, edges: vertical(25),
  }), (error) => error instanceof RoomError && error.code === NetworkErrorCode.PersistenceFailed);
  assert.equal(room.revision, revision);
  assert.equal(room.gameState.mapCreation.regionCount, 1);
});

test("waiting-room removal is host-only, durable, and unavailable after the game starts", async () => {
  const store = new TestRoomStore();
  const rooms = manager(store);
  const host = await rooms.createRoom("Anna");
  const guest = await rooms.joinRoom(host.room.roomId, "Ben");
  await assert.rejects(() => rooms.removeWaitingParticipant(host.room.roomId, guest.sessionToken, host.participant.playerId),
    (error) => error.code === NetworkErrorCode.NotHost);

  store.failSaves = true;
  await assert.rejects(() => rooms.removeWaitingParticipant(host.room.roomId, host.sessionToken, guest.participant.playerId),
    (error) => error.code === NetworkErrorCode.PersistenceFailed);
  assert.equal(host.room.participants.has(guest.participant.playerId), true);

  store.failSaves = false;
  const removed = await rooms.removeWaitingParticipant(host.room.roomId, host.sessionToken, guest.participant.playerId);
  assert.equal(removed.removed.playerId, guest.participant.playerId);
  assert.equal(host.room.participants.has(guest.participant.playerId), false);
  assert.equal((await store.load(host.room.roomId)).participants.some((player) => player.playerId === guest.participant.playerId), false);
  assert.throws(() => rooms.authenticate(host.room.roomId, guest.sessionToken), (error) => error.code === NetworkErrorCode.InvalidSession);

  const replacement = await rooms.joinRoom(host.room.roomId, "Clara");
  await rooms.startRoom(host.room.roomId, host.sessionToken, [host.participant.playerId, replacement.participant.playerId], host.participant.playerId);
  await assert.rejects(() => rooms.removeWaitingParticipant(host.room.roomId, host.sessionToken, replacement.participant.playerId),
    (error) => error.code === NetworkErrorCode.RoomAlreadyStarted);
});

test("a rematch creates and persists an independent waiting room", async () => {
  const store = new TestRoomStore();
  const rooms = manager(store);
  const { room: source, participant: host, guest, annaToken, guestToken } = await startTwoPlayers(rooms);
  source.status = "FINISHED";
  const sourceMap = { ...source.map };
  await assert.rejects(() => rooms.createRematch(source.roomId, guestToken), (error) => error.code === NetworkErrorCode.NotHost);

  const rematch = await rooms.createRematch(source.roomId, annaToken);
  assert.notEqual(rematch.room.roomId, source.roomId);
  assert.equal(rematch.room.status, "WAITING");
  assert.equal(rematch.room.rematchOfRoomId, source.roomId);
  assert.deepEqual(rematch.room.map, sourceMap);
  assert.equal(rematch.room.participants.size, 1);
  assert.notEqual(rematch.participant.playerId, host.playerId);
  assert.notEqual(rematch.sessionToken, annaToken);
  assert.equal(source.status, "FINISHED");
  assert.deepEqual(source.map, sourceMap);

  const restored = manager(store);
  await restored.restore();
  const restoredRematch = restored.getRoom(rematch.room.roomId);
  assert.equal(restoredRematch.status, "WAITING");
  assert.equal(restoredRematch.rematchOfRoomId, source.roomId);
  assert.deepEqual(restoredRematch.map, sourceMap);
});

test("restored snapshots still create redacted player views for hidden bids, spades, and factions", async () => {
  const store = new TestRoomStore();
  const roomsA = manager(store);
  const { room, participant: anna, guest, annaToken } = await startTwoPlayers(roomsA);
  const snapshot = await store.load(room.roomId);
  const baseState = createGameState({
    gameId: room.roomId,
    startPlayerId: anna.playerId,
    players: [
      { id: anna.playerId, name: "Anna", secretFactionSuit: Suit.Diamonds },
      { id: guest.participant.playerId, name: "Ben", secretFactionSuit: Suit.Clubs },
    ],
  });
  await store.save({
    ...snapshot,
    status: "RUNNING",
    revision: room.revision + 1,
    gameState: {
      ...baseState,
      phase: GamePhase.StartAuctions,
      auction: {
        id: "hidden-auction", kind: "START", territoryId: "G01", auctioneerPlayerId: anna.playerId,
        eligiblePlayerIds: [anna.playerId, guest.participant.playerId],
        submittedBids: { [anna.playerId]: { kind: "START", value: 3 }, [guest.participant.playerId]: { kind: "START", value: 1 } },
      },
    },
  });
  const roomsB = manager(store);
  await roomsB.restore();
  const restored = roomsB.getRoom(room.roomId);
  const benView = roomsB.getPlayerView(restored, guest.participant.playerId);
  assert.equal(benView.players.find((player) => player.id === anna.playerId).secretFactionSuit, undefined);
  assert.equal(benView.viewerSecretFactionSuit, Suit.Clubs);
  assert.deepEqual(benView.auction.submittedBids[anna.playerId], { submitted: true });

  const warSnapshot = await store.load(room.roomId);
  await store.save({
    ...warSnapshot,
    gameState: {
      ...baseState,
      phase: GamePhase.ActionPhase,
      pendingWar: {
        id: "hidden-spade-war", attackerPlayerId: anna.playerId, defenderPlayerId: guest.participant.playerId,
        attackerTerritoryId: "G01", defenderTerritoryId: "G02", stage: "AWAITING_COMBAT_CHOICES",
        attackerArea: 20, defenderArea: 20, originalSharedBorder: [],
        spadeChoices: { [anna.playerId]: "anna-private-spade", [guest.participant.playerId]: null },
      },
    },
  });
  const roomsC = manager(store);
  await roomsC.restore();
  const benWarView = roomsC.getPlayerView(roomsC.getRoom(room.roomId), guest.participant.playerId);
  assert.equal(benWarView.pendingWar.spadeChoices[anna.playerId], "LOCKED");
  assert.equal(JSON.stringify(benWarView).includes("anna-private-spade"), false);
  assert.equal(roomsC.authenticate(room.roomId, annaToken).participant.playerId, anna.playerId);
});

test("HTTP and WebSocket transport still sends individual player views", async () => {
  const rooms = manager();
  const server = createVedrasServer({ roomManager: rooms, port: 0, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = "http://127.0.0.1:" + server.port;
  const created = await fetch(base + "/api/rooms", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerName: "Anna" }),
  }).then((response) => response.json());
  const joined = await fetch(base + "/api/rooms/" + created.roomId + "/join", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerName: "Ben" }),
  }).then((response) => response.json());
  const annaSocket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
  const benSocket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
  await Promise.all([once(annaSocket, "open"), once(benSocket, "open")]);
  const annaSnapshot = nextMessage(annaSocket);
  const benSnapshot = nextMessage(benSocket);
  annaSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: created.roomId, sessionToken: created.sessionToken }));
  benSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: joined.roomId, sessionToken: joined.sessionToken }));
  await Promise.all([annaSnapshot, benSnapshot]);
  const room = rooms.getRoom(created.roomId);
  const state = createGameState({
    gameId: room.roomId, startPlayerId: created.playerId,
    players: [{ id: created.playerId, name: "Anna", secretFactionSuit: Suit.Diamonds }, { id: joined.playerId, name: "Ben", secretFactionSuit: Suit.Clubs }],
  });
  room.status = "RUNNING";
  room.gameState = { ...state, phase: GamePhase.StartAuctions, auction: {
    id: "hidden", kind: "START", territoryId: "G01", auctioneerPlayerId: created.playerId,
    eligiblePlayerIds: [created.playerId, joined.playerId], submittedBids: { [created.playerId]: { kind: "START", value: 3 } },
  } };
  room.revision += 1;
  const annaView = nextMessage(annaSocket);
  const benView = nextMessage(benSocket);
  broadcastRoom(rooms, room);
  const [, ben] = await Promise.all([annaView, benView]);
  assert.equal(ben.gameView.players.find((player) => player.id === created.playerId).secretFactionSuit, undefined);
  assert.deepEqual(ben.gameView.auction.submittedBids[created.playerId], { submitted: true });
  annaSocket.close();
  benSocket.close();
  await server.close();
});

test("HTTP removal sends a terminal PLAYER_REMOVED state to the connected guest", async () => {
  const rooms = manager();
  const server = createVedrasServer({ roomManager: rooms, port: 0, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = "http://127.0.0.1:" + server.port;
  try {
    const host = await fetch(base + "/api/rooms", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerName: "Anna" }),
    }).then((response) => response.json());
    const guest = await fetch(base + "/api/rooms/" + host.roomId + "/join", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerName: "Ben" }),
    }).then((response) => response.json());
    const socket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
    await once(socket, "open");
    const joined = nextMessage(socket);
    socket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: guest.roomId, sessionToken: guest.sessionToken }));
    await joined;

    const notHost = await fetch(base + "/api/rooms/" + host.roomId + "/players/" + host.playerId + "/remove", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionToken: guest.sessionToken }),
    });
    assert.equal(notHost.status, 403);
    assert.equal((await notHost.json()).code, NetworkErrorCode.NotHost);

    const removed = nextMessage(socket);
    const response = await fetch(base + "/api/rooms/" + host.roomId + "/players/" + guest.playerId + "/remove", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionToken: host.sessionToken }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await removed, { type: "SERVER_ERROR", code: NetworkErrorCode.PlayerRemoved, message: "Du wurdest aus diesem Raum entfernt." });
    assert.equal(rooms.getRoom(host.roomId).participants.has(guest.playerId), false);
    socket.close();
  } finally {
    await server.close();
  }
});

test("a finished-room rematch notifies connected former players without changing the old room", async () => {
  const rooms = manager();
  const server = createVedrasServer({ roomManager: rooms, port: 0, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = "http://127.0.0.1:" + server.port;
  try {
    const host = await fetch(base + "/api/rooms", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerName: "Anna" }),
    }).then((response) => response.json());
    const guest = await fetch(base + "/api/rooms/" + host.roomId + "/join", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerName: "Ben" }),
    }).then((response) => response.json());
    const guestSocket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
    await once(guestSocket, "open");
    const connected = nextMessage(guestSocket);
    guestSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: guest.roomId, sessionToken: guest.sessionToken }));
    await connected;
    const source = rooms.getRoom(host.roomId);
    source.status = "FINISHED";
    const offer = nextMessage(guestSocket);
    const response = await fetch(base + "/api/rooms/" + host.roomId + "/rematch", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionToken: host.sessionToken }),
    });
    assert.equal(response.status, 201);
    const rematch = await response.json();
    assert.notEqual(rematch.roomId, host.roomId);
    assert.notEqual(rematch.sessionToken, host.sessionToken);
    assert.deepEqual(await offer, { type: "REMATCH_OFFER", roomId: rematch.roomId, rematchOfRoomId: host.roomId });
    assert.equal(rooms.getRoom(host.roomId).status, "FINISHED");
    assert.equal(rooms.getRoom(rematch.roomId).status, "WAITING");
    guestSocket.close();
  } finally {
    await server.close();
  }
});

test("transport rejects malformed and oversized WebSocket input", async () => {
  const server = createVedrasServer({ roomManager: manager(), port: 0, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const malformed = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
  await once(malformed, "open");
  const rejected = nextMessage(malformed);
  malformed.send(JSON.stringify({ type: "GAME_COMMAND", commandId: "missing-action" }));
  assert.equal((await rejected).code, NetworkErrorCode.InvalidMessage);
  malformed.close();

  const oversized = new WebSocket("ws://127.0.0.1:" + server.port + "/ws");
  await once(oversized, "open");
  const closed = new Promise((resolve) => oversized.once("close", (code) => resolve(code)));
  oversized.once("error", () => {});
  oversized.send(Buffer.alloc(MAX_WEBSOCKET_PAYLOAD_BYTES + 1, 65));
  const code = await closed;
  assert.equal(code, 1009);
  await server.close();
});

test("production server serves the built client on one origin without exposing internal paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vedras-web-"));
  const assets = join(directory, "assets");
  await mkdir(assets);
  await writeFile(join(directory, "index.html"), "<main>Vedras Production</main>", "utf8");
  await writeFile(join(assets, "app.js"), "console.log('asset')", "utf8");
  const server = createVedrasServer({
    roomManager: manager(),
    port: 0,
    staticDirectory: directory,
    production: true,
    webOrigins: ["https://staging.example.invalid"],
    allowCrossOrigin: false,
    logger: () => {},
  });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = "http://127.0.0.1:" + server.port;
  try {
    const page = await fetch(base + "/", { headers: { origin: "https://staging.example.invalid" } });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<main>Vedras Production</main>");
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("access-control-allow-origin"), null);
    const foreignOrigin = await fetch(base + "/", { headers: { origin: "https://foreign.example.invalid" } });
    assert.equal(foreignOrigin.status, 403);

    const clientRoute = await fetch(base + "/room/ABC123");
    assert.equal(clientRoute.status, 200);
    assert.equal(await clientRoute.text(), "<main>Vedras Production</main>");
    const asset = await fetch(base + "/assets/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

    for (const protectedPath of ["/api/rooms", "/ws", "/data/rooms/ROOM1.json", "/%2e%2e/data/rooms/ROOM1.json"]) {
      const response = await fetch(base + protectedPath);
      assert.notEqual(response.status, 200, protectedPath);
      assert.doesNotMatch(await response.text(), /Vedras Production/);
    }
    const health = await fetch(base + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", storage: "ok", protocolVersion: 1 });

    const socket = new WebSocket("ws://127.0.0.1:" + server.port + "/ws", { headers: { origin: "https://staging.example.invalid" } });
    await once(socket, "open");
    socket.close();
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("error", reject);
  });
}
