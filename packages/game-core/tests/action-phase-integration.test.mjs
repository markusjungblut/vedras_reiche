import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAction,
  beginActionPhase,
  createGameState,
  createTerritoryCard,
  DomainErrorCode,
  GameActionType,
  GameEventType,
  GamePhase,
  startRound,
  Suit,
} from "../dist/index.js";

const timestamp = "2026-09-18T15:00:00.000Z";

class SequenceRandomSource {
  constructor(values) { this.values = [...values]; }
  nextInt(min, max) {
    assert.ok(this.values.length > 0, `Unexpected random draw in [${min}, ${max}]`);
    const value = this.values.shift();
    assert.ok(Number.isInteger(value) && value >= min && value <= max);
    return value;
  }
}

function territory(id, ownerId, adjacentTerritoryIds, activationNumber = 12) {
  return {
    id,
    ownerId,
    area: 8,
    adjacentTerritoryIds,
    card: createTerritoryCard(ownerId === "B" ? Suit.Spades : Suit.Hearts, activationNumber),
  };
}

function readyGame() {
  const setup = createGameState({
    gameId: "action-integration",
    players: ["A", "B", "C"].map((id) => ({ id, globalInfluence: 6, availableBasicBids: [1, 2, 3] })),
    startPlayerId: "A",
  });
  return {
    ...setup,
    phase: GamePhase.RoundReady,
    startAuctions: {
      round: 2,
      displayTerritoryIds: [],
      firstDisplayTerritoryIds: [],
      nextDisplayIndex: 0,
      auctioneerPlayerId: "A",
      awardedPlayerIds: ["A", "B", "C"],
      availableBidsByPlayerId: {},
    },
    territories: [
      territory("A1", "A", ["N3"]), territory("A2", "A", []),
      territory("B1", "B", ["N1"], 2), territory("B2", "B", []),
      territory("C1", "C", ["N2"]), territory("C2", "C", []),
      territory("N1", null, ["B1"]), territory("N2", null, ["C1"]),
      territory("N3", null, ["A1"]),
    ],
  };
}

function action(state, details) {
  return applyAction(state, details, { randomSource: new SequenceRandomSource([]), timestamp });
}

function auction(state, playerId, territoryId, bids) {
  let result = action(state, { type: GameActionType.OpenAuction, playerId, territoryId });
  for (const [bidder, basicBid, globalInfluence = 0] of bids) {
    result = action(result.state, {
      type: GameActionType.SubmitAuctionBid,
      playerId: bidder,
      auctionId: result.state.auction.id,
      bid: { kind: "NORMAL", basicBid, globalInfluence, localInfluence: 0 },
    });
  }
  return result;
}

test("AP2 activation and a full AP3 action phase preserve foreign winner turns and guard the next round", () => {
  // Select B, then roll 2, 5, 9. Only B1 activates.
  const first = startRound(readyGame(), new SequenceRandomSource([1, 1, 4, 3, 1, 5, 1]), timestamp);
  assert.equal(first.state.phase, GamePhase.ActivationPhase);
  assert.equal(first.state.startPlayerId, "B");
  assert.deepEqual(first.state.activation.pendingTerritoryIds, ["B1"]);
  const activated = action(first.state, {
    type: GameActionType.ActivateTerritory,
    playerId: "B",
    territoryId: "B1",
    choice: { type: "SPADE_STORE" },
  });
  assert.equal(activated.state.phase, GamePhase.ActionPhase);
  assert.equal(activated.state.activePlayerId, "B");
  const beforeRejectedRound = structuredClone(activated.state);
  assert.throws(() => startRound(activated.state, new SequenceRandomSource([]), timestamp),
    (error) => error.code === DomainErrorCode.InvalidPhase);
  assert.deepEqual(activated.state, beforeRejectedRound);

  // C wins B's auction. Only B's basic action is completed.
  const firstAuction = auction(activated.state, "B", "N1", [
    ["A", 1], ["B", 2], ["C", 3],
  ]);
  assert.equal(firstAuction.state.territories.find((item) => item.id === "N1").ownerId, "C");
  assert.deepEqual(firstAuction.state.actionPhase.completedPlayerIds, ["B"]);
  assert.equal(firstAuction.state.activePlayerId, "C");
  assert.deepEqual(firstAuction.state.players.find((player) => player.id === "C").availableBasicBids, [1, 2]);
  assert.deepEqual(firstAuction.state.players.find((player) => player.id === "B").availableBasicBids, [1, 2, 3]);

  const secondAuction = auction(firstAuction.state, "C", "N2", [
    ["A", 1], ["B", 2], ["C", 2, 1],
  ]);
  assert.equal(secondAuction.state.activePlayerId, "A");
  assert.deepEqual(secondAuction.state.actionPhase.completedPlayerIds, ["B", "C"]);
  const thirdAuction = auction(secondAuction.state, "A", "N3", [
    ["A", 3], ["B", 1], ["C", 1],
  ]);
  assert.equal(thirdAuction.state.phase, GamePhase.RoundReady);
  assert.deepEqual(thirdAuction.state.actionPhase.completedPlayerIds, ["B", "C", "A"]);
  assert.ok(thirdAuction.events.some((event) => event.type === GameEventType.ActionPhaseFinished));
  assert.ok(thirdAuction.events.some((event) => event.type === GameEventType.RoundFinished));

  const next = startRound(thirdAuction.state, new SequenceRandomSource([2, 1, 1, 2, 1, 3, 1, 4, 1]), timestamp);
  assert.equal(next.state.round, 2);
  assert.equal(next.state.startPlayerId, "C");
});

test("the first three-way tie allows ending the turn; a second tie ends it automatically", () => {
  const base = {
    ...readyGame(),
    phase: GamePhase.ActionPhase,
    round: 1,
    startPlayerId: "B",
    activePlayerId: "B",
    actionPhase: { completedPlayerIds: [], auctionsOpenedByActivePlayer: 0, secondAuctionAvailable: false },
  };
  const bids = [["A", 2], ["B", 2], ["C", 2]];
  const first = auction(base, "B", "N1", bids);
  assert.equal(first.state.activePlayerId, "B");
  assert.equal(first.state.actionPhase.secondAuctionAvailable, true);
  assert.throws(() => action(first.state, { type: GameActionType.EndActionTurn, playerId: "A" }),
    (error) => error.code === DomainErrorCode.NotActivePlayer);
  const ended = action(first.state, { type: GameActionType.EndActionTurn, playerId: "B" });
  assert.equal(ended.state.activePlayerId, "C");
  assert.deepEqual(ended.state.actionPhase.completedPlayerIds, ["B"]);

  const repeated = auction(first.state, "B", "N1", bids);
  assert.equal(repeated.state.activePlayerId, "C");
  assert.deepEqual(repeated.state.actionPhase.completedPlayerIds, ["B"]);
  assert.equal(repeated.state.actionPhase.secondAuctionAvailable, false);
  assert.throws(() => action(repeated.state, { type: GameActionType.OpenAuction, playerId: "B", territoryId: "N1" }),
    (error) => error.code === DomainErrorCode.NotActivePlayer);
});

test("a potential war keeps the player active and opens only an AP4 pending handoff", () => {
  const base = {
    ...readyGame(),
    phase: GamePhase.ActivationPhase,
    round: 1,
    activation: { pendingTerritoryIds: [], resolvedTerritoryIds: [] },
    startPlayerId: "A",
    territories: [
      territory("A1", "A", ["B1"]),
      territory("B1", "B", ["A1"]),
    ],
  };
  const phase = beginActionPhase(base, timestamp);
  assert.equal(phase.state.phase, GamePhase.ActionPhase);
  assert.equal(phase.state.activePlayerId, "A");
  const started = action(phase.state, {
    type: GameActionType.StartWar,
    playerId: "A",
    attackerTerritoryId: "A1",
    defenderTerritoryId: "B1",
  });
  assert.deepEqual(started.state.pendingWar, {
    playerId: "A", attackerTerritoryId: "A1", defenderTerritoryId: "B1",
  });
  assert.equal(started.state.territories.find((item) => item.id === "B1").ownerId, "B");
  assert.throws(() => startRound(started.state, new SequenceRandomSource([]), timestamp),
    (error) => error.code === DomainErrorCode.InvalidPhase);
});

test("the fully completed last round enters scoring", () => {
  const base = {
    ...readyGame(),
    phase: GamePhase.ActivationPhase,
    round: 9,
    activation: { pendingTerritoryIds: [], resolvedTerritoryIds: [] },
    territories: [
      territory("A1", "A", []),
      territory("B1", "B", []),
      territory("C1", "C", []),
    ],
  };
  const finished = beginActionPhase(base, timestamp);
  assert.equal(finished.state.phase, GamePhase.Scoring);
  assert.equal(finished.state.actionPhase.completedPlayerIds.length, 3);
  assert.ok(finished.events.some((event) => event.type === GameEventType.ActionPhaseFinished));
  assert.ok(finished.events.some((event) => event.type === GameEventType.RoundFinished));
  assert.ok(finished.events.some((event) => event.type === GameEventType.ScoringStarted));
  assert.throws(() => startRound(finished.state, new SequenceRandomSource([]), timestamp),
    (error) => error.code === DomainErrorCode.InvalidPhase);
});
