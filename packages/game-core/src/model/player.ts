import type { EffectId, PlayerId } from "./ids.js";
import type { Suit } from "./territory-card.js";

export interface Player {
  readonly id: PlayerId;
  readonly name?: string;
  /** Available after the start auctions; its value is not initialized by this model. */
  readonly globalInfluence?: number;
  /** Tracks bids independently from the rule's list of possible basic bid values. */
  readonly availableBasicBids?: readonly number[];
  readonly secretFactionSuit?: Suit;
  readonly availableEffectIds?: readonly EffectId[];
  readonly usedEffectIds?: readonly EffectId[];
  /** Future turn or round status, without defining transition rules yet. */
  readonly turnStatus?: string;
}
