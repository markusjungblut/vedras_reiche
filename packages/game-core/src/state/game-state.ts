import type { GameEvent } from "../events/game-event.js";
import type { BorderMark } from "../model/border-mark.js";
import type { GameId, PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import type { PointOfInterest } from "../model/point-of-interest.js";
import type { Territory } from "../model/territory.js";
import type { GamePhase } from "./game-phase.js";
import type {
  ActivationPhaseState,
  PendingDiamondBorderChange,
  SpadeActivation,
} from "./activation-phase-state.js";

export interface GameState {
  readonly gameId: GameId;
  readonly phase: GamePhase;
  /** Zero means the first round has not started yet. */
  readonly round: number;
  readonly maxRounds: number;
  /** Array order is the permanent clockwise player order. */
  readonly players: readonly Player[];
  readonly territories: readonly Territory[];
  readonly pointsOfInterest: readonly PointOfInterest[];
  readonly borderMarks: readonly BorderMark[];
  readonly startPlayerId: PlayerId;
  readonly activePlayerId?: PlayerId | undefined;
  readonly activationNumbers: readonly number[];
  readonly activation?: ActivationPhaseState;
  readonly pendingDiamondBorderChanges: readonly PendingDiamondBorderChange[];
  readonly spadeActivations: readonly SpadeActivation[];
  readonly events: readonly GameEvent[];
}
