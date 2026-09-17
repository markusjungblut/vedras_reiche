import type { GameEvent } from "../events/game-event.js";
import type { GameState } from "../state/game-state.js";

/** Contract for future validated action handlers. */
export interface ActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}
