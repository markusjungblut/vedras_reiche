import type { TerritoryId } from "../model/ids.js";
import type { GameState } from "../state/game-state.js";

/** Controlled matching territories, with each territory returned at most once. */
export function getActivatedTerritories(
  state: GameState,
  activationNumbers: readonly number[],
): TerritoryId[] {
  const rolledNumbers = new Set(activationNumbers);
  const playerIds = new Set(state.players.map((player) => player.id));
  const activated = new Set<TerritoryId>();

  for (const territory of state.territories) {
    if (territory.ownerId === null || !playerIds.has(territory.ownerId) || territory.card === undefined) {
      continue;
    }
    const { activationNumber, additionalActivationNumber } = territory.card;
    if (
      rolledNumbers.has(activationNumber) ||
      (additionalActivationNumber !== undefined && rolledNumbers.has(additionalActivationNumber))
    ) {
      activated.add(territory.id);
    }
  }

  return [...activated];
}
