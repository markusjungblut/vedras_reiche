import type { GameState, PlayerGameView } from "@vedras/game-core";

/**
 * The complete local state is structurally compatible with this projection.
 * Remote rendering deliberately uses the redacted PlayerGameView, never a
 * disguised GameState.
 */
export type GameReadModel = GameState | PlayerGameView;
