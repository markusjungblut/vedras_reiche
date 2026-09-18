import { Suit, createTerritoryCard, type TerritoryCard } from "../model/territory-card.js";
import type { RandomSource } from "../utils/random-source.js";

export const PRINTED_TERRITORY_SUITS = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades] as const;

/** The 48 printed territory cards, each exactly once. */
export function createPrintedTerritoryCardDeck(): TerritoryCard[] {
  return PRINTED_TERRITORY_SUITS.flatMap((suit) => Array.from({ length: 12 }, (_, index) =>
    createTerritoryCard(suit, index + 1)));
}

function drawIndex(random: RandomSource, size: number): number {
  const index = random.nextInt(0, size - 1);
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    throw new RangeError("Random source returned an invalid card index.");
  }
  return index;
}

/** Selects an equal number of printed cards per suit, then shuffles them together. */
export function drawBalancedStartingTerritoryCards(
  playerCount: number,
  random: RandomSource,
): TerritoryCard[] {
  const cardsPerSuit = playerCount + 1;
  if (!Number.isInteger(playerCount) || cardsPerSuit < 3 || cardsPerSuit > 7) {
    throw new RangeError("Starting territory cards require two to six players.");
  }
  const selected: TerritoryCard[] = [];
  for (const suit of PRINTED_TERRITORY_SUITS) {
    const pool = Array.from({ length: 12 }, (_, index) => createTerritoryCard(suit, index + 1));
    for (let index = 0; index < cardsPerSuit; index += 1) {
      selected.push(pool.splice(drawIndex(random, pool.length), 1)[0]!);
    }
  }
  for (let index = selected.length - 1; index > 0; index -= 1) {
    const otherIndex = drawIndex(random, index + 1);
    [selected[index], selected[otherIndex]] = [selected[otherIndex]!, selected[index]!];
  }
  return selected;
}

/** A deterministic, serialisable key for detecting duplicate printed cards. */
export function printedTerritoryCardKey(card: TerritoryCard): string {
  return `${card.suit}:${card.activationNumber}`;
}
