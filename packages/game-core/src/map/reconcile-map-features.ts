import type { GameState } from "../state/game-state.js";
import type { Territory } from "../model/territory.js";
import { getGridCellTerritory } from "./grid-map.js";

/** Moves cell-bound development with its cell; cards and other territory data stay with IDs. */
export function reconcileMapBoundFeatures(state: GameState): GameState {
  if (state.map === undefined) return state;
  const withoutFeatures: Territory[] = state.territories.map((territory) => {
    if (territory.settlementFeature === undefined && territory.settlementFeatures === undefined) return territory;
    const { settlement: _settlement, settlementFeature: _feature, settlementFeatures: _features, ...rest } = territory;
    return rest;
  });
  const byId = new Map(withoutFeatures.map((territory) => [territory.id, territory]));
  for (const territory of state.territories) {
    const features = territory.settlementFeatures ?? (territory.settlementFeature ? [territory.settlementFeature] : []);
    for (const feature of features) {
      const targetId = getGridCellTerritory(state.map, feature.position);
      if (targetId === null || targetId === undefined) continue;
      const target = byId.get(targetId);
      if (target !== undefined) {
        const collected = [...(target.settlementFeatures ?? []), feature];
        byId.set(targetId, { ...target, settlement: collected[0]!.kind,
          settlementFeature: collected[0]!, settlementFeatures: collected });
      }
    }
  }
  return { ...state, territories: state.territories.map((territory) => byId.get(territory.id)!) };
}
