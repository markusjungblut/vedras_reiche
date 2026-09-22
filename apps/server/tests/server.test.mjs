import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";

import { CryptoCardSource } from "../dist/random.js";
import { RoomManager } from "../dist/room-manager.js";
import { createVedrasServer, broadcastRoom } from "../dist/server.js";
import { GameActionType, GamePhase, Suit, createGameState, getMinimumTerritoryArea } from "@vedras/game-core";
import { NetworkErrorCode } from "@vedras/protocol";

class FixedRandomSource {
  nextInt(min) { return min; }
}

function manager() {
  let room = 0;
  let player = 0;
  let token = 0;
  return new RoomManager({
    randomSource: new FixedRandomSource(),
    cardSource: new CryptoCardSource(),
    now: () => "2026-09-21T12:00:00.000Z",
    roomIdFactory: () => "ROOM" + (++room),
    playerIdFactory: () => "P" + (++player),
    sessionTokenFactory: () => "token-" + (++token),
  });
}

function startTwoPlayers(roomManager) {
  const host = roomManager.createRoom("Anna");
  const guest = roomManager.joinRoom(host.room.roomId, "Ben");
  roomManager.startRoom(host.room.roomId, host.participant.sessionToken,
    [host.participant.playerId, guest.participant.playerId], host.participant.playerId);
  return { ...host, guest };
}

function vertical(cut) {
  return Array.from({ length: 50 }, (_, y) => ({
    from: { x: cut - 1, y }, to: { x: cut, y },
  }));
}

function tripleSplit() {
  return [...vertical(16), ...vertical(33)];
}

test("room lifecycle enforces player count, host authority, and start state", () => {
  const rooms = manager();
  const host = rooms.createRoom("Anna");
  assert.equal(host.room.status, "WAITING");
  assert.equal(host.room.participants.size, 1);
  assert.throws(() => rooms.startRoom(host.room.roomId, host.participant.sessionToken, [host.participant.playerId], host.participant.playerId),
    (error) => error.code === NetworkErrorCode.InvalidStartConfiguration);

  const guest = rooms.joinRoom(host.room.roomId, "Ben");
  assert.throws(() => rooms.startRoom(host.room.roomId, guest.participant.sessionToken,
    [host.participant.playerId, guest.participant.playerId], host.participant.playerId),
  (error) => error.code === NetworkErrorCode.NotHost);

  for (const name of ["Clara", "Dora", "Egon", "Frida"]) rooms.joinRoom(host.room.roomId, name);
  assert.equal(host.room.participants.size, 6);
  assert.throws(() => rooms.joinRoom(host.room.roomId, "Gabi"), (error) => error.code === NetworkErrorCode.RoomFull);

  const order = [...host.room.participants.keys()];
  rooms.startRoom(host.room.roomId, host.participant.sessionToken, order, host.participant.playerId);
  assert.equal(host.room.status, "RUNNING");
  assert.throws(() => rooms.startRoom(host.room.roomId, host.participant.sessionToken, order, host.participant.playerId),
    (error) => error.code === NetworkErrorCode.RoomAlreadyStarted);
  assert.throws(() => rooms.joinRoom(host.room.roomId, "Gabi"), (error) => error.code === NetworkErrorCode.RoomAlreadyStarted);
  assert.throws(() => rooms.authenticate(host.room.roomId, "not-a-token"), (error) => error.code === NetworkErrorCode.InvalidSession);
});

test("the host configures the authoritative lobby map before the game starts", () => {
  const rooms = manager();
  const host = rooms.createRoom("Anna");
  const guest = rooms.joinRoom(host.room.roomId, "Ben");
  assert.throws(() => rooms.updateMap(host.room.roomId, guest.participant.sessionToken, { width: 100, height: 50 }),
    (error) => error.code === NetworkErrorCode.NotHost);
  assert.throws(() => rooms.updateMap(host.room.roomId, host.participant.sessionToken, { width: 0, height: 50 }),
    (error) => error.code === NetworkErrorCode.InvalidStartConfiguration);
  rooms.updateMap(host.room.roomId, host.participant.sessionToken, { width: 100, height: 50 });
  assert.deepEqual(rooms.getPublicRoomState(host.room).map, { width: 100, height: 50 });
  rooms.startRoom(host.room.roomId, host.participant.sessionToken,
    [host.participant.playerId, guest.participant.playerId], host.participant.playerId);
  assert.equal(host.room.gameState.map.width, 100);
  assert.equal(host.room.gameState.map.height, 50);
  assert.equal(getMinimumTerritoryArea(host.room.gameState.map), 50);
  assert.throws(() => rooms.updateMap(host.room.roomId, host.participant.sessionToken, { width: 50, height: 50 }),
    (error) => error.code === NetworkErrorCode.RoomAlreadyStarted);
});

test("commands are authoritative, serialized, identity-bound, and deduplicated", async () => {
  const rooms = manager();
  const { room, participant: anna, guest } = startTwoPlayers(rooms);
  const revision = room.revision;
  const impersonation = await rooms.processCommand(room.roomId, anna.sessionToken, "impersonate", {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: guest.participant.playerId,
    edges: vertical(25),
  });
  assert.equal(impersonation.accepted, false);
  assert.equal(room.revision, revision);

  const invalid = await rooms.processCommand(room.roomId, anna.sessionToken, "invalid", {
    type: GameActionType.BeginMapCreation,
    playerId: anna.playerId,
    firstPlayerId: anna.playerId,
    map: { width: 50, height: 50 },
  });
  assert.equal(invalid.accepted, false);
  assert.equal(room.revision, revision);

  const accepted = await rooms.processCommand(room.roomId, anna.sessionToken, "split-once", {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: anna.playerId,
    edges: vertical(25),
  });
  assert.equal(accepted.accepted, true);
  assert.equal(room.revision, revision + 1);
  assert.equal(room.gameState.mapCreation.regionCount, 2);

  const duplicate = await rooms.processCommand(room.roomId, anna.sessionToken, "split-once", {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: anna.playerId,
    edges: vertical(25),
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(room.revision, revision + 1);
});

test("multiplayer setup commits are server-validated and broadcast the same two-region revision", async () => {
  const rooms = manager();
  const { room, participant: anna, guest } = startTwoPlayers(rooms);
  const revision = room.revision;
  const annaMessages = [];
  const benMessages = [];
  rooms.attachConnection(room.roomId, anna.sessionToken, { send: (message) => annaMessages.push(message), close: () => {} });
  rooms.attachConnection(room.roomId, guest.participant.sessionToken, { send: (message) => benMessages.push(message), close: () => {} });

  const inactive = await rooms.processCommand(room.roomId, guest.participant.sessionToken, "guest-split", {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: guest.participant.playerId,
    edges: vertical(25),
  });
  assert.equal(inactive.accepted, false);
  assert.equal(room.revision, revision);

  const malicious = await rooms.processCommand(room.roomId, anna.sessionToken, "three-way", {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: anna.playerId,
    edges: tripleSplit(),
  });
  assert.equal(malicious.accepted, false);
  assert.equal(room.revision, revision);
  assert.equal(room.gameState.mapCreation.regionCount, 1);

  const accepted = await rooms.processCommand(room.roomId, anna.sessionToken, "midline", {
    type: GameActionType.CommitSetupBoundaryDraft,
    playerId: anna.playerId,
    edges: vertical(25),
  });
  assert.equal(accepted.accepted, true);
  assert.equal(room.revision, revision + 1);
  assert.equal(room.gameState.mapCreation.regionCount, 2);

  broadcastRoom(rooms, room);
  const annaSnapshot = annaMessages.at(-1);
  const benSnapshot = benMessages.at(-1);
  assert.equal(annaSnapshot.type, "ROOM_SNAPSHOT");
  assert.equal(benSnapshot.type, "ROOM_SNAPSHOT");
  assert.equal(annaSnapshot.revision, revision + 1);
  assert.equal(benSnapshot.revision, revision + 1);
  const annaView = annaSnapshot.gameView;
  const benView = benSnapshot.gameView;
  assert.equal(annaView.mapCreation.regionCount, 2);
  assert.equal(benView.mapCreation.regionCount, 2);
  assert.deepEqual(Object.values(annaView.map.cells).reduce((counts, id) => {
    counts[id] = (counts[id] ?? 0) + 1; return counts;
  }, {}), Object.values(benView.map.cells).reduce((counts, id) => {
    counts[id] = (counts[id] ?? 0) + 1; return counts;
  }, {}));
  assert.deepEqual(Object.values(annaView.map.cells).reduce((counts, id) => {
    counts[id] = (counts[id] ?? 0) + 1; return counts;
  }, {}), { R01: 1250, R02: 1250 });
});

test("reconnecting a session replaces the connection and receives the current player view", () => {
  const rooms = manager();
  const { room, participant: anna } = startTwoPlayers(rooms);
  const sent = [];
  const first = { send: (message) => sent.push(message), close: () => {} };
  rooms.attachConnection(room.roomId, anna.sessionToken, first);
  const second = { send: () => {}, close: () => {} };
  const replacement = rooms.attachConnection(room.roomId, anna.sessionToken, second);
  assert.equal(replacement.previousConnection, first);
  rooms.disconnect(room.roomId, anna.playerId, first);
  assert.equal(rooms.getPublicRoomState(room).players.find((player) => player.playerId === anna.playerId).connected, true);
  broadcastRoom(rooms, room);
  assert.equal(sent.length, 0);
  assert.equal(rooms.getPlayerView(room, anna.playerId).gameId, room.roomId);
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("error", reject);
  });
}

test("HTTP and two WebSocket clients receive individual redacted snapshots", async () => {
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
  annaSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: created.roomId, sessionToken: created.sessionToken }));
  benSocket.send(JSON.stringify({ type: "AUTHENTICATE", protocolVersion: 1, roomId: joined.roomId, sessionToken: joined.sessionToken }));
  await Promise.all([nextMessage(annaSocket), nextMessage(benSocket)]);

  const room = rooms.getRoom(created.roomId);
  const baseState = createGameState({
    gameId: room.roomId,
    startPlayerId: created.playerId,
    players: [
      { id: created.playerId, name: "Anna", secretFactionSuit: Suit.Diamonds },
      { id: joined.playerId, name: "Ben", secretFactionSuit: Suit.Clubs },
    ],
  });
  room.status = "RUNNING";
  room.gameState = {
    ...baseState,
    phase: GamePhase.StartAuctions,
    auction: {
      id: "hidden-auction",
      kind: "START",
      territoryId: "G01",
      auctioneerPlayerId: created.playerId,
      eligiblePlayerIds: [created.playerId, joined.playerId],
      submittedBids: {
        [created.playerId]: { kind: "START", value: 3 },
        [joined.playerId]: { kind: "START", value: 1 },
      },
    },
  };
  room.revision += 1;
  const annaSnapshot = nextMessage(annaSocket);
  const benSnapshot = nextMessage(benSocket);
  broadcastRoom(rooms, room);
  const [anna, ben] = await Promise.all([annaSnapshot, benSnapshot]);

  assert.equal(anna.type, "ROOM_SNAPSHOT");
  assert.equal(anna.gameView.players.find((player) => player.id === created.playerId).secretFactionSuit, Suit.Diamonds);
  assert.equal(anna.gameView.players.find((player) => player.id === joined.playerId).secretFactionSuit, undefined);
  assert.equal(ben.gameView.players.find((player) => player.id === joined.playerId).secretFactionSuit, Suit.Clubs);
  assert.equal(ben.gameView.players.find((player) => player.id === created.playerId).secretFactionSuit, undefined);
  assert.deepEqual(ben.gameView.auction.submittedBids[created.playerId], { submitted: true });
  assert.deepEqual(anna.gameView.auction.submittedBids[joined.playerId], { submitted: true });
  assert.equal(JSON.stringify(ben).includes('"value":3'), false);
  assert.equal(JSON.stringify(anna).includes('"value":1'), false);

  room.gameState = {
    ...baseState,
    phase: GamePhase.ActionPhase,
    pendingWar: {
      id: "hidden-spade-war",
      attackerPlayerId: created.playerId,
      defenderPlayerId: joined.playerId,
      attackerTerritoryId: "G01",
      defenderTerritoryId: "G02",
      stage: "AWAITING_COMBAT_CHOICES",
      attackerArea: 20,
      defenderArea: 20,
      originalSharedBorder: [],
      spadeChoices: { [created.playerId]: "anna-private-spade", [joined.playerId]: null },
    },
  };
  room.revision += 1;
  const annaWarSnapshot = nextMessage(annaSocket);
  const benWarSnapshot = nextMessage(benSocket);
  broadcastRoom(rooms, room);
  const [annaWar, benWar] = await Promise.all([annaWarSnapshot, benWarSnapshot]);
  assert.equal(annaWar.gameView.pendingWar.spadeChoices[created.playerId], "anna-private-spade");
  assert.equal(benWar.gameView.pendingWar.spadeChoices[created.playerId], "LOCKED");
  assert.equal(JSON.stringify(benWar).includes("anna-private-spade"), false);

  room.gameState = { ...baseState, phase: GamePhase.Finished };
  room.status = "FINISHED";
  room.revision += 1;
  const annaFinishedSnapshot = nextMessage(annaSocket);
  const benFinishedSnapshot = nextMessage(benSocket);
  broadcastRoom(rooms, room);
  const [annaFinished, benFinished] = await Promise.all([annaFinishedSnapshot, benFinishedSnapshot]);
  assert.equal(annaFinished.gameView.players.find((player) => player.id === joined.playerId).secretFactionSuit, Suit.Clubs);
  assert.equal(benFinished.gameView.players.find((player) => player.id === created.playerId).secretFactionSuit, Suit.Diamonds);

  annaSocket.close();
  benSocket.close();
  await server.close();
});
