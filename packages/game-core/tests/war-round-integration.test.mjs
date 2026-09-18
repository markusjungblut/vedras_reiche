import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, createGameState, createGridMap, GameActionType, GamePhase, startRound, Suit } from "../dist/index.js";

const timestamp = "2026-09-18T15:00:00.000Z";
class Dice {
  constructor(...values) { this.values = values; }
  nextInt(min, max) {
    const value = this.values.shift();
    assert.ok(value >= min && value <= max, `unexpected draw ${value} in ${min}–${max}`);
    return value;
  }
}
function act(state, action, random = new Dice()) {
  return applyAction(state, action, { randomSource: random, timestamp }).state;
}
function auction(state, opener, territoryId) {
  let next = act(state, { type: GameActionType.OpenAuction, playerId: opener, territoryId });
  const auctionId = next.auction.id;
  for (const player of next.players) next = act(next, { type: GameActionType.SubmitAuctionBid,
    playerId: player.id, auctionId,
    bid: { kind: "NORMAL", basicBid: player.id === opener ? 3 : 1, globalInfluence: 0, localInfluence: 0 } });
  return next;
}

test("three-player round combines activation, auction, spade war, border gain and next-round reset", () => {
  const ids = ["N1", "A", "B", "C", "N2"];
  const cells = {};
  for (let y = 0; y < 5; y++) for (let x = 0; x < 40; x++) cells[`${x},${y}`] = ids[Math.floor(x / 8)];
  const setup = createGameState({ gameId: "integrated-war-round",
    players: ["A", "B", "C"].map((id) => ({ id, globalInfluence: 6, availableBasicBids: [1, 2, 3] })),
    startPlayerId: "A" });
  const state = { ...setup, phase: GamePhase.RoundReady,
    startAuctions: { round: 2, displayTerritoryIds: [], firstDisplayTerritoryIds: [], nextDisplayIndex: 0,
      auctioneerPlayerId: "A", awardedPlayerIds: ["A", "B", "C"], availableBidsByPlayerId: {} },
    map: createGridMap({ width: 40, height: 5, format: "A4" }, cells),
    territories: ids.map((id) => ({ id, ownerId: id.startsWith("N") ? null : id,
      card: { suit: id === "B" ? Suit.Spades : Suit.Hearts, activationNumber: id === "B" ? 1 : 12 } })) };
  let round = startRound(state, new Dice(0, 1, 1, 2, 1, 3, 1), timestamp).state;
  assert.equal(round.phase, GamePhase.ActivationPhase);
  assert.deepEqual(round.activation.pendingTerritoryIds, ["B"]);
  round = act(round, { type: GameActionType.ActivateTerritory, playerId: "B", territoryId: "B",
    choice: { type: "SPADE_STORE" } });
  assert.equal(round.phase, GamePhase.ActionPhase);
  assert.equal(round.activePlayerId, "A");
  assert.equal(round.spadeActivations.length, 1);
  round = auction(round, "A", "N1");
  assert.equal(round.activePlayerId, "B");
  round = act(round, { type: GameActionType.StartWar, playerId: "B", attackerTerritoryId: "B", defenderTerritoryId: "C" });
  const warId = round.pendingWar.id;
  round = act(round, { type: GameActionType.SetWarSpadeChoice, warId, playerId: "B",
    spadeActivationId: round.spadeActivations[0].id });
  round = act(round, { type: GameActionType.SetWarSpadeChoice, warId, playerId: "C",
    spadeActivationId: null }, new Dice(3, 3));
  assert.equal(round.pendingWar.combat.difference, 2);
  assert.equal(round.pendingWar.maximumDepth, 2);
  round = act(round, { type: GameActionType.ProposeBorderAdvance, warId, playerId: "B",
    claimedCells: [{ x: 24, y: 0 }] });
  assert.equal(round.map.cells["24,0"], "B");
  assert.equal(round.activePlayerId, "C");
  assert.equal(round.spadeActivations[0].status, "USED");
  round = auction(round, "C", "N2");
  assert.equal(round.phase, GamePhase.RoundReady);
  assert.ok(round.territories.find((territory) => territory.id === "B").participatedInWarThisRound);
  const next = startRound(round, new Dice(4, 4, 5, 4, 6, 4), timestamp).state;
  assert.equal(next.round, 2);
  assert.equal(next.territories.find((territory) => territory.id === "B").participatedInWarThisRound, false);
  assert.equal(next.spadeActivations.length, 0);
  assert.equal(next.lastWarResult, undefined);
});
