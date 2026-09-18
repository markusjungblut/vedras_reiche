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

/**
 * Resolves the common two-way cut-and-choose roles for both auction kinds.
 * The reference player is the auctioneer for a start auction and the opener
 * for a normal auction.
 */
export function determineSplitRoles(
  playerOrder: readonly PlayerId[],
  referencePlayerId: PlayerId,
  tiedPlayerIds: readonly [PlayerId, PlayerId],
): { readonly dividerPlayerId: PlayerId; readonly firstChooserPlayerId: PlayerId } {
  validatePlayerOrder(playerOrder);
  if (!playerOrder.includes(referencePlayerId) || tiedPlayerIds[0] === tiedPlayerIds[1] ||
      tiedPlayerIds.some((id) => !playerOrder.includes(id))) {
    throw new Error("Split roles require seated, distinct players.");
  }
  if (tiedPlayerIds.includes(referencePlayerId)) {
    return {
      dividerPlayerId: referencePlayerId,
      firstChooserPlayerId: tiedPlayerIds.find((id) => id !== referencePlayerId)!,
    };
  }
  const clockwise = getPlayerOrderFromStartPlayer(playerOrder, referencePlayerId);
  const dividerPlayerId = clockwise.find((id) => tiedPlayerIds.includes(id))!;
  return {
    dividerPlayerId,
    firstChooserPlayerId: tiedPlayerIds.find((id) => id !== dividerPlayerId)!,
  };
}
