import type { TerritoryId } from "../model/ids.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";

/** The active player chooses one of these; array order carries no rule priority. */
export function getAvailableActivationTerritoryIds(state: GameState): TerritoryId[] {
  if (state.phase !== GamePhase.ActivationPhase || state.activePlayerId === undefined) {
    return [];
  }

  const pending = new Set(state.activation?.pendingTerritoryIds ?? []);
  return state.territories
    .filter((territory) => territory.ownerId === state.activePlayerId && pending.has(territory.id))
    .map((territory) => territory.id);
}
