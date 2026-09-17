import type { BorderMarkId, PlayerId, TerritoryId } from "./ids.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";

/** A mark belongs to one shared border and one player (§12). */
export interface BorderMark {
  readonly id: BorderMarkId;
  readonly territoryIds: readonly [TerritoryId, TerritoryId];
  readonly playerId: PlayerId;
}

/** A length-safe, orientation-independent ID for an abstract shared border. */
export function getCanonicalBorderId(a: TerritoryId, b: TerritoryId): BorderMarkId {
  if (a === b) {
    throw new DomainError(DomainErrorCode.InvalidBorderTarget);
  }
  return `border:${JSON.stringify([a, b].sort())}`;
}
