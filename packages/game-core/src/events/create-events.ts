import { GameEventType, type GameEvent } from "./game-event.js";
import type { GameState } from "../state/game-state.js";
import type { PlayerId } from "../model/ids.js";

export interface EventDescription {
  readonly type: GameEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorId?: PlayerId;
}

/** Caller-controlled timestamp and state log position keep event metadata replayable. */
export function createEvents(
  state: GameState,
  timestamp: string,
  descriptions: readonly EventDescription[],
): GameEvent[] {
  return descriptions.map((description, index) => ({
    id: `${state.gameId}:event:${state.events.length + index + 1}`,
    type: description.type,
    timestamp,
    ...(description.actorId === undefined ? {} : { actorId: description.actorId }),
    payload: description.payload,
  }));
}
