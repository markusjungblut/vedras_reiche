/** Values confirmed by the full rulebook (§1 and §9). */
export const RULES = {
  playerCount: { min: 2, max: 6 },
  roundCountByPlayerCount: {
    2: 10,
    3: 9,
    4: 8,
    5: 8,
    6: 8,
  },
  startingInfluence: 6,
  basicBids: [1, 2, 3],
} as const;

export type SupportedPlayerCount = keyof typeof RULES.roundCountByPlayerCount;
