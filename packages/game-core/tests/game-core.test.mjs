import assert from "node:assert/strict";
import test from "node:test";

import {
  GamePhase,
  Suit,
  createGameState,
  createTerritoryCard,
  getRoundCount,
} from "../dist/index.js";

const roundCounts = new Map([
  [2, 10],
  [3, 9],
  [4, 8],
  [5, 8],
  [6, 8],
]);

for (const [playerCount, expectedRounds] of roundCounts) {
  test(`${playerCount} players have ${expectedRounds} rounds`, () => {
    assert.equal(getRoundCount(playerCount), expectedRounds);
  });
}

for (const playerCount of [1, 7, 2.5]) {
  test(`invalid player count ${playerCount} is rejected`, () => {
    assert.throws(() => getRoundCount(playerCount), RangeError);
  });
}

for (const activationNumber of [1, 12]) {
  test(`territory card accepts activation number ${activationNumber}`, () => {
    assert.deepEqual(createTerritoryCard(Suit.Hearts, activationNumber), {
      suit: Suit.Hearts,
      activationNumber,
    });
  });
}

for (const activationNumber of [0, 13, 1.5]) {
  test(`territory card rejects activation number ${activationNumber}`, () => {
    assert.throws(() => createTerritoryCard(Suit.Hearts, activationNumber), RangeError);
  });
}

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `player-${index + 1}` }));
}

for (const [playerCount, expectedRounds] of roundCounts) {
  test(`creates a minimal setup state for ${playerCount} players`, () => {
    const players = Object.freeze(makePlayers(playerCount).map(Object.freeze));
    const input = Object.freeze({
      gameId: `game-${playerCount}`,
      players,
      startPlayerId: players[0].id,
    });

    const state = createGameState(input);

    assert.equal(state.gameId, input.gameId);
    assert.equal(state.phase, GamePhase.Setup);
    assert.equal(state.round, 0);
    assert.equal(state.maxRounds, expectedRounds);
    assert.deepEqual(state.players, players);
    assert.notStrictEqual(state.players, players);
    assert.equal(state.startPlayerId, input.startPlayerId);
    assert.equal(state.activePlayerId, undefined);
    assert.deepEqual(state.territories, []);
    assert.deepEqual(state.pointsOfInterest, []);
    assert.deepEqual(state.borderMarks, []);
    assert.deepEqual(state.activationNumbers, []);
    assert.deepEqual(state.events, []);
    assert.deepEqual(input.players, players);
  });
}

test("createGameState rejects duplicate player IDs", () => {
  assert.throws(
    () => createGameState({
      gameId: "duplicate-players",
      players: [{ id: "same" }, { id: "same" }],
      startPlayerId: "same",
    }),
    /Player IDs must be unique/,
  );
});

test("createGameState rejects a start player outside the game", () => {
  assert.throws(
    () => createGameState({
      gameId: "unknown-start-player",
      players: makePlayers(2),
      startPlayerId: "outsider",
    }),
    /Start player must be one of the players/,
  );
});
