import { createTerritoryCard, Suit } from "@vedras/game-core";
import type { CardSource, RandomSource, TerritoryCard } from "@vedras/game-core";

const SUITS = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades] as const;

/** The 48 printed suit/number combinations are drawn with replacement. */
export class DemoCardSource implements CardSource {
  drawAndReplace(randomSource: RandomSource): TerritoryCard {
    const index = randomSource.nextInt(0, 47);
    const suit = SUITS[Math.floor(index / 12)];
    if (suit === undefined) {
      throw new RangeError("Die Debug-Kartenquelle erhielt einen ungültigen Kartenindex.");
    }
    return createTerritoryCard(suit, (index % 12) + 1);
  }
}
