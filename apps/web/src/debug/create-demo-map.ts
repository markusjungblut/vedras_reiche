import {
  createGridMap,
  createTerritoryCard,
  Suit,
  type GridMapState,
} from "@vedras/game-core";
import type { Territory } from "@vedras/game-core";

const SUITS = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades] as const;
const NUMBERS = [2, 5, 11, 7, 4, 10, 6, 12, 3, 9, 1, 8, 5, 11, 2, 6] as const;

/** The visual fixture uses sixteen 8×5 rectangles on a 32×20 raster. */
export function createDemoMap(): Territory[] {
  return Array.from({ length: 16 }, (_, index) => {
    const id = `G${String(index + 1).padStart(2, "0")}`;
    // Keep the default scripted winners on distinct development paths: G05 is
    // a club card so the activation demo exposes the ♣ controls immediately.
    const suit = index === 4 ? Suit.Clubs : SUITS[index % SUITS.length]!;
    const activationNumber = NUMBERS[index]!;
    return {
      id,
      ownerId: null,
      card: createTerritoryCard(suit, activationNumber),
      localInfluenceByPlayerId: {},
    };
  });
}

export function createDemoGridMap(): GridMapState {
  const cells: Record<string, string> = {};
  for (let region = 0; region < 16; region += 1) {
    const column = region % 4;
    const row = Math.floor(region / 4);
    const id = `G${String(region + 1).padStart(2, "0")}`;
    for (let y = row * 5; y < row * 5 + 5; y += 1) {
      for (let x = column * 8; x < column * 8 + 8; x += 1) cells[`${x},${y}`] = id;
    }
  }
  return createGridMap({ width: 32, height: 20, format: "A4" }, cells);
}
