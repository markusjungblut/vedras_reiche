export enum Suit {
  Diamonds = "DIAMONDS",
  Clubs = "CLUBS",
  Hearts = "HEARTS",
  Spades = "SPADES",
}

interface TerritoryCardBase {
  readonly suit: Suit;
  readonly activationNumber: number;
}

/** A card can gain either an activation number or a suit, never both (§13). */
export type TerritoryCard = TerritoryCardBase & (
  | { readonly additionalActivationNumber?: never; readonly additionalSuit?: never }
  | { readonly additionalActivationNumber: number; readonly additionalSuit?: never }
  | { readonly additionalActivationNumber?: never; readonly additionalSuit: Suit }
);

/** Checks the card's printed activation number, not any later bonus number. */
export function createTerritoryCard(
  suit: Suit,
  activationNumber: number,
): TerritoryCard {
  if (!Number.isInteger(activationNumber) || activationNumber < 1 || activationNumber > 12) {
    throw new RangeError("Territory card activation number must be an integer from 1 to 12.");
  }

  return { suit, activationNumber };
}
