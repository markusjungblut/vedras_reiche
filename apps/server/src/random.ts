import { randomInt } from "node:crypto";
import { createTerritoryCard, Suit, type CardSource, type RandomSource, type TerritoryCard } from "@vedras/game-core";

const SUITS = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades] as const;

/** Production gameplay randomness is generated only by Node's cryptographic RNG. */
export class CryptoRandomSource implements RandomSource {
  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new RangeError("Invalid random range.");
    return randomInt(min, max + 1);
  }
}

/** The 48 printed cards are drawn with replacement, as required by CardSource. */
export class CryptoCardSource implements CardSource {
  drawAndReplace(randomSource: RandomSource): TerritoryCard {
    const index = randomSource.nextInt(0, 47);
    const suit = SUITS[Math.floor(index / 12)];
    if (suit === undefined) throw new RangeError("Invalid territory-card index.");
    return createTerritoryCard(suit, index % 12 + 1);
  }
}
