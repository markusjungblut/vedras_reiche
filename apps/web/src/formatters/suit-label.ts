import { Suit, type TerritoryCard } from "@vedras/game-core";

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case Suit.Diamonds: return "♦";
    case Suit.Clubs: return "♣";
    case Suit.Hearts: return "♥";
    case Suit.Spades: return "♠";
  }
}

export function suitName(suit: Suit): string {
  switch (suit) {
    case Suit.Diamonds: return "Karo";
    case Suit.Clubs: return "Kreuz";
    case Suit.Hearts: return "Herz";
    case Suit.Spades: return "Pik";
  }
}

export function suitClass(suit: Suit): string {
  return suit === Suit.Diamonds || suit === Suit.Hearts ? "suit-red" : "suit-dark";
}

export function cardText(card: TerritoryCard): string {
  const suits = `${suitSymbol(card.suit)}${card.additionalSuit === undefined ? "" : ` ${suitSymbol(card.additionalSuit)}`}`;
  const numbers = `${card.activationNumber}${card.additionalActivationNumber === undefined ? "" : ` / ${card.additionalActivationNumber}`}`;
  return `${suits} ${numbers}`;
}
