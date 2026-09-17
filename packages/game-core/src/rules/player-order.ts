import type { PlayerId } from "../model/ids.js";
import type { RandomSource } from "../utils/random-source.js";

function validatePlayerOrder(playerOrder: readonly PlayerId[]): void {
  if (playerOrder.length === 0 || new Set(playerOrder).size !== playerOrder.length) {
    throw new Error("Player order must contain distinct players.");
  }
}

/** Selects one seated player using the injected, reproducible random source. */
export function selectInitialStartPlayer(
  playerOrder: readonly PlayerId[],
  randomSource: RandomSource,
): PlayerId {
  validatePlayerOrder(playerOrder);
  const index = randomSource.nextInt(0, playerOrder.length - 1);
  if (!Number.isInteger(index) || index < 0 || index >= playerOrder.length) {
    throw new RangeError("Random source returned an invalid player index.");
  }
  return playerOrder[index]!;
}

/** Clockwise successor, wrapping from the last player to the first. */
export function getNextPlayer(
  playerOrder: readonly PlayerId[],
  currentPlayerId: PlayerId,
): PlayerId {
  validatePlayerOrder(playerOrder);
  const currentIndex = playerOrder.indexOf(currentPlayerId);
  if (currentIndex === -1) {
    throw new Error("Current player is not in player order.");
  }
  return playerOrder[(currentIndex + 1) % playerOrder.length]!;
}

/** A complete clockwise pass beginning with the round's start player. */
export function getPlayerOrderFromStartPlayer(
  playerOrder: readonly PlayerId[],
  startPlayerId: PlayerId,
): PlayerId[] {
  validatePlayerOrder(playerOrder);
  const startIndex = playerOrder.indexOf(startPlayerId);
  if (startIndex === -1) {
    throw new Error("Start player is not in player order.");
  }
  return [...playerOrder.slice(startIndex), ...playerOrder.slice(0, startIndex)];
}
