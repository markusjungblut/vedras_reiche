import { createTerritoryCard, Suit } from "@vedras/game-core";
import type { Territory } from "@vedras/game-core";

const SUITS = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades] as const;
const NUMBERS = [2, 5, 11, 7, 4, 10, 6, 12, 3, 9, 1, 8, 5, 11, 2, 6] as const;

/** A fixed abstract graph. Its edges are game data, unrelated to the screen layout. */
export function createDemoMap(): Territory[] {
  return Array.from({ length: 16 }, (_, index) => {
    const id = `G${String(index + 1).padStart(2, "0")}`;
    const adjacentTerritoryIds = Array.from({ length: 16 }, (_, other) => other)
      .filter((other) => {
        const clockwise = (other - index + 16) % 16;
        return clockwise !== 0 && Math.min(clockwise, 16 - clockwise) <= 4;
      })
      .map((other) => `G${String(other + 1).padStart(2, "0")}`);
    // Keep the default scripted winners on distinct development paths: G05 is
    // a club card so the activation demo exposes the ♣ controls immediately.
    const suit = index === 4 ? Suit.Clubs : SUITS[index % SUITS.length]!;
    const activationNumber = NUMBERS[index]!;
    return {
      id,
      ownerId: null,
      area: 18 + ((index * 7) % 17),
      adjacentTerritoryIds,
      card: createTerritoryCard(suit, activationNumber),
      pointOfInterestIds: [],
      localInfluenceByPlayerId: {},
    };
  });
}
