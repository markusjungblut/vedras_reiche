import type { TerritoryId } from "../model/ids.js";
import type { GameState } from "../state/game-state.js";

const DISPLAY_ID = /^G(\d+)$/;

function displayNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = DISPLAY_ID.exec(value);
  if (match === null) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function highestKnownNumber(state: GameState): number {
  const values = state.territories.flatMap((territory) => [displayNumber(territory.id)]).concat(state.events.flatMap((event) => {
    const payload = event.payload as Readonly<Record<string, unknown>>;
    return [displayNumber(payload.newTerritoryId), displayNumber(payload.territoryId)];
  })).filter((value): value is number => value !== undefined);
  return Math.max(0, ...values);
}

export function territoryDisplayId(number: number): TerritoryId {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("Territory display number must be positive.");
  return `G${String(number).padStart(2, "0")}`;
}

/**
 * Reserves the next player-facing territory identifier.
 * The counter is persisted in GameState; the event scan keeps older snapshots safe.
 */
export function allocateNextTerritoryId(state: GameState): {
  readonly territoryId: TerritoryId;
  readonly nextTerritoryDisplayNumber: number;
} {
  let number = Math.max(state.nextTerritoryDisplayNumber ?? 1, highestKnownNumber(state) + 1);
  const used = new Set(state.territories.map((territory) => territory.id));
  while (used.has(territoryDisplayId(number))) number += 1;
  return { territoryId: territoryDisplayId(number), nextTerritoryDisplayNumber: number + 1 };
}
