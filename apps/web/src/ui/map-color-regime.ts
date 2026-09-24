import { GamePhase } from "@vedras/game-core";
import type { GameReadModel } from "../game-read-model";

/** Visual-only map state derived from the authoritative game phase. */
export type MapColorRegime = "SETUP_TERRITORIES" | "OWNERSHIP";

export function getMapColorRegime(state: Pick<GameReadModel, "phase">): MapColorRegime {
  return state.phase === GamePhase.MapCreation || state.phase === GamePhase.Setup || state.phase === GamePhase.StartAuctions
    ? "SETUP_TERRITORIES"
    : "OWNERSHIP";
}
