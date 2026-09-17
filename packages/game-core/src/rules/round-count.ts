import { RULES, type SupportedPlayerCount } from "./config.js";

export function getRoundCount(playerCount: number): number {
  if (!Number.isInteger(playerCount) ||
      playerCount < RULES.playerCount.min ||
      playerCount > RULES.playerCount.max) {
    throw new RangeError(
      `Player count must be an integer from ${RULES.playerCount.min} to ${RULES.playerCount.max}.`,
    );
  }

  return RULES.roundCountByPlayerCount[playerCount as SupportedPlayerCount];
}
