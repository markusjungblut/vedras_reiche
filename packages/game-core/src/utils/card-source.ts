import type { TerritoryCard } from "../model/territory-card.js";
import type { RandomSource } from "./random-source.js";

/** Draws a random card, then returns and reshuffles it before the next draw (§13). */
export interface CardSource {
  drawAndReplace(randomSource: RandomSource): TerritoryCard;
}
