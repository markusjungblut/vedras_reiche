import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { once } from "node:events";

import { AccountManager } from "../dist/account-store.js";
import { FileMatchHistoryStore, MemoryMatchHistoryStore, aggregateAccountStats, buildMatchSummary } from "../dist/match-history.js";
import { CryptoCardSource } from "../dist/random.js";
import { RoomManager } from "../dist/room-manager.js";
import { createVedrasServer } from "../dist/server.js";
import { GameEventType, GamePhase, createGameState } from "@vedras/game-core";

class FixedRandomSource { nextInt(min) { return min; } }

class TestRoomStore {
  constructor() { this.rooms = new Map(); }
  async loadAll() { return [...this.rooms.values()].map((room) => JSON.parse(JSON.stringify(room))); }
  async load(roomId) { const room = this.rooms.get(roomId); return room === undefined ? undefined : JSON.parse(JSON.stringify(room)); }
  async save(room) { this.rooms.set(room.roomId, JSON.parse(JSON.stringify(room))); }
  async delete(roomId) { this.rooms.delete(roomId); }
}

function event(id, type, actorId, payload) {
  return { id, type, timestamp: "2026-09-24T12:00:00.000Z", ...(actorId === undefined ? {} : { actorId }), payload };
}

function finishedState() {
  const base = createGameState({ gameId: "MATCH1", startPlayerId: "P1", players: [
    { id: "P1", name: "Anna", secretFactionSuit: "DIAMONDS" },
    { id: "P2", name: "Ben", secretFactionSuit: "CLUBS" },
  ] });
  return {
    ...base,
    phase: GamePhase.Finished,
    round: 6,
    territories: [
      { id: "T1", ownerId: "P1", area: 12, settlementFeatures: [] },
      { id: "T2", ownerId: "P2", area: 8, settlementFeatures: [] },
    ],
    events: [
      event("1", GameEventType.ActionPhaseStarted, undefined, { round: 1, playerId: "P1" }),
      event("2", GameEventType.AuctionBidSubmitted, "P1", { auctionId: "A1", playerId: "P1" }),
      event("3", GameEventType.AuctionBidsRevealed, undefined, { auctionId: "A1", bids: { P1: { kind: "NORMAL", basicBid: 3, globalInfluence: 2, localInfluence: 1 } } }),
      event("4", GameEventType.AuctionWon, "P1", { auctionId: "A1", playerId: "P1" }),
      event("5", GameEventType.TerritoryOwnerChanged, "P1", { territoryId: "T1", previousOwnerId: null, ownerId: "P1" }),
      event("6", GameEventType.WarStarted, "P1", { warId: "W1", playerId: "P1", attackerTerritoryId: "T1", defenderPlayerId: "P2", defenderTerritoryId: "T2" }),
      event("7", GameEventType.CombatRolled, undefined, { warId: "W1", outcome: "BORDER_ADVANCE", winnerTerritoryId: "T1", attackerSpadeBonus: 1, defenderSpadeBonus: 0 }),
      event("8", GameEventType.BorderAdvanceResolved, "P1", { warId: "W1", directTransferCells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], annexedDisconnectedCells: [{ x: 2, y: 2 }] }),
      event("9", GameEventType.TerritoryActivated, "P1", { playerId: "P1", territoryId: "T1", selectedSuit: "DIAMONDS" }),
      event("10", GameEventType.DiamondBorderMarked, "P1", { playerId: "P1" }),
      event("11", GameEventType.ClubCityCreated, "P2", { playerId: "P2" }),
      event("12", GameEventType.HeartGlobalInfluenceGained, "P1", { playerId: "P1", amount: 1 }),
      event("13", GameEventType.SpadeActivationStored, "P1", { playerId: "P1", effectId: "S1" }),
      event("14", GameEventType.SpadeActivationUsed, undefined, { warId: "W1", activationId: "S1" }),
    ],
    result: {
      winnerPlayerIds: ["P1"],
      playerResults: [
        { playerId: "P1", totalScoreHundredths: 1200, controlledTerritoryCount: 1, controlledArea: 12, activeRelicCount: 0, largestRealmTerritoryIds: [], territoryScores: [] },
        { playerId: "P2", totalScoreHundredths: 800, controlledTerritoryCount: 1, controlledArea: 8, activeRelicCount: 0, largestRealmTerritoryIds: [], territoryScores: [] },
      ],
    },
  };
}

function summary(matchId = "MATCH1") {
  const built = buildMatchSummary({
    matchId, startedAt: "2026-09-24T11:00:00.000Z", finishedAt: "2026-09-24T12:00:00.000Z", state: finishedState(),
    telemetry: { maxTerritoryCountByPlayerId: { P1: 4, P2: 2 }, maxControlledAreaByPlayerId: { P1: 21, P2: 11 }, largestSingleBorderGainByPlayerId: { P1: 3 } },
    participants: [{ accountId: "account-1", playerId: "P1", displayNameSnapshot: "Anna" }, { accountId: "account-2", playerId: "P2", displayNameSnapshot: "Ben" }],
  });
  assert.ok(built);
  return built;
}

test("match summary derives stable event counters, final values, and persisted peaks", () => {
  const built = summary();
  const anna = built.players.find((player) => player.accountId === "account-1");
  const ben = built.players.find((player) => player.accountId === "account-2");
  assert.equal(anna.stats.placement, 1);
  assert.equal(anna.stats.warsStarted, 1);
  assert.equal(anna.stats.warsWon, 1);
  assert.equal(ben.stats.warsLost, 1);
  assert.equal(anna.stats.totalWarCellsGained, 3);
  assert.equal(anna.stats.largestBorderGainCells, 3);
  assert.equal(anna.stats.maxControlledAreaCells, 21);
  assert.equal(anna.stats.auctionsParticipated, 1);
  assert.equal(anna.stats.totalBidAmount, 6);
  assert.equal(anna.stats.highestBid, 6);
  assert.equal(anna.stats.diamondActivations, 1);
  assert.equal(anna.stats.spadeActivationsUsed, 1);
  assert.equal(anna.stats.spadeBonusUsedInWars, 1);
  assert.equal(ben.stats.citiesBuilt, 1);
  const aggregate = aggregateAccountStats([built], "account-1");
  assert.deepEqual({ matchesPlayed: aggregate.matchesPlayed, wins: aggregate.wins, maxArea: aggregate.records.maxControlledAreaCells },
    { matchesPlayed: 1, wins: 1, maxArea: 21 });
});

test("file match history is immutable, idempotent, and survives a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vedras-matches-"));
  try {
    const first = summary();
    const storeA = new FileMatchHistoryStore(directory);
    await storeA.ensureReady();
    await storeA.save(first);
    await storeA.save(first);
    await assert.rejects(() => storeA.save({ ...first, finishedAt: "2026-09-25T12:00:00.000Z" }), /immutable/);
    const storeB = new FileMatchHistoryStore(directory);
    const restored = await storeB.get(first.matchId);
    assert.deepEqual(restored, first);
    assert.deepEqual((await storeB.listForAccount("account-1")).map((item) => item.matchId), [first.matchId]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restoring a finished account room backfills one archive without duplication", async () => {
  const roomsStore = new TestRoomStore();
  const history = new MemoryMatchHistoryStore();
  let roomId = 0; let playerId = 0; let token = 0;
  const options = () => ({ randomSource: new FixedRandomSource(), cardSource: new CryptoCardSource(), roomStore: roomsStore, matchHistoryStore: history,
    now: () => "2026-09-24T12:00:00.000Z", roomIdFactory: () => `ROOM${++roomId}`, playerIdFactory: () => `P${++playerId}`, sessionTokenFactory: () => `room-token-${++token}` });
  const first = new RoomManager(options());
  const host = await first.createRoom("Anna", "account-1");
  const guest = await first.joinRoom(host.room.roomId, "Ben", "account-2");
  await first.startRoom(host.room.roomId, host.sessionToken, [host.participant.playerId, guest.participant.playerId], host.participant.playerId);
  const snapshot = await roomsStore.load(host.room.roomId);
  const state = { ...finishedState(), gameId: host.room.roomId };
  await roomsStore.save({ ...snapshot, status: "FINISHED", gameState: state, updatedAt: "2026-09-24T13:00:00.000Z" });
  const restored = new RoomManager(options());
  await restored.restore();
  assert.equal((await history.listForAccount("account-1")).length, 1);
  const restarted = new RoomManager(options());
  await restarted.restore();
  assert.equal((await history.listForAccount("account-1")).length, 1);
});

test("match history endpoints require the participant account and expose only personal details", async () => {
  const history = new MemoryMatchHistoryStore();
  await history.save(summary());
  const accounts = new AccountManager({ accountIdFactory: (() => { let id = 0; return () => `account-${++id}`; })(), sessionTokenFactory: (() => { let id = 0; return () => `token-${++id}`; })() });
  await accounts.restore();
  const anna = await accounts.register("anna", "Anna", "ein-sicheres-passwort");
  const ben = await accounts.register("ben", "Ben", "ein-sicheres-passwort");
  const rooms = new RoomManager({ randomSource: new FixedRandomSource(), cardSource: new CryptoCardSource(), matchHistoryStore: history });
  const server = createVedrasServer({ roomManager: rooms, accountManager: accounts, port: 0, logger: () => {} });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const annaCookie = `vedras_account_session=${anna.sessionToken}`;
    const benCookie = `vedras_account_session=${ben.sessionToken}`;
    const stats = await fetch(`${base}/api/me/stats`, { headers: { cookie: annaCookie } });
    assert.equal(stats.status, 200);
    assert.equal((await stats.json()).matchesPlayed, 1);
    const matches = await fetch(`${base}/api/me/matches?limit=1`, { headers: { cookie: annaCookie } });
    assert.deepEqual((await matches.json()).matches.map((item) => item.matchId), ["MATCH1"]);
    const detail = await fetch(`${base}/api/me/matches/MATCH1`, { headers: { cookie: annaCookie } });
    const detailPayload = await detail.json();
    assert.equal(detail.status, 200);
    assert.equal(detailPayload.ownStats.warsWon, 1);
    assert.equal(JSON.stringify(detailPayload).includes("account-2"), false);
    const foreign = await fetch(`${base}/api/me/matches/MATCH1`, { headers: { cookie: benCookie } });
    assert.equal(foreign.status, 200);
    const unrelated = await accounts.register("clara", "Clara", "ein-sicheres-passwort");
    const denied = await fetch(`${base}/api/me/matches/MATCH1`, { headers: { cookie: `vedras_account_session=${unrelated.sessionToken}` } });
    assert.equal(denied.status, 404);
  } finally { await server.close(); }
});
