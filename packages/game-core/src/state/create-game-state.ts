import type { GameId, PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import { getRoundCount } from "../rules/round-count.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";

export interface NewGame {
  readonly gameId: GameId;
  readonly players: readonly Player[];
  readonly startPlayerId: PlayerId;
}

/** Creates a pre-map setup state without applying later setup or auction rules. */
export function createGameState({ gameId, players, startPlayerId }: NewGame): GameState {
  const maxRounds = getRoundCount(players.length);

  if (gameId.trim().length === 0) {
    throw new Error("Game ID must not be empty.");
  }

  const playerIds = players.map((player) => player.id);
  if (playerIds.some((id) => id.trim().length === 0)) {
    throw new Error("Player IDs must not be empty.");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("Player IDs must be unique.");
  }
  if (!playerIds.includes(startPlayerId)) {
    throw new Error("Start player must be one of the players.");
  }

  return {
    gameId,
    phase: GamePhase.Setup,
    round: 0,
    maxRounds,
    players: [...players],
    territories: [],
    nextTerritoryDisplayNumber: 1,
    pointsOfInterest: [],
    borderMarks: [],
    startPlayerId,
    activationNumbers: [],
    pendingDiamondBorderChanges: [],
    spadeActivations: [],
    events: [],
  };
}
