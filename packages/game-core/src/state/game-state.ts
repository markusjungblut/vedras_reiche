import type { GameEvent } from "../events/game-event.js";
import type { AuctionState, PendingTerritorySplit, StartAuctionsState } from "../auctions/auction-state.js";
import type { BorderMark } from "../model/border-mark.js";
import type { GameId, PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import type { PointOfInterest } from "../model/point-of-interest.js";
import type { Territory } from "../model/territory.js";
import type { GridMapState } from "../map/grid-map.js";
import type { GamePhase } from "./game-phase.js";
import type {
  ActivationPhaseState,
  PendingDiamondBorderChange,
  SpadeActivation,
} from "./activation-phase-state.js";
import type { ActionPhaseState, PendingWar } from "./action-phase-state.js";
import type { CombatResult } from "./action-phase-state.js";

export interface GameState {
  readonly gameId: GameId;
  readonly phase: GamePhase;
  /** Zero means the first round has not started yet. */
  readonly round: number;
  readonly maxRounds: number;
  /** Array order is the permanent clockwise player order. */
  readonly players: readonly Player[];
  readonly territories: readonly Territory[];
  /** Authoritative raster geometry; omitted only during pre-map setup. */
  readonly map?: GridMapState;
  readonly pointsOfInterest: readonly PointOfInterest[];
  readonly borderMarks: readonly BorderMark[];
  readonly startPlayerId: PlayerId;
  readonly activePlayerId?: PlayerId | undefined;
  readonly activationNumbers: readonly number[];
  readonly activation?: ActivationPhaseState;
  readonly startAuctions?: StartAuctionsState | undefined;
  readonly actionPhase?: ActionPhaseState | undefined;
  readonly auction?: AuctionState | undefined;
  readonly pendingSplit?: PendingTerritorySplit | undefined;
  readonly pendingWar?: PendingWar | undefined;
  readonly lastWarResult?: {
    readonly round: number;
    readonly attackerPlayerId: PlayerId;
    readonly defenderPlayerId: PlayerId;
    readonly attackerTerritoryId: string;
    readonly defenderTerritoryId: string;
    readonly combat: CombatResult;
  } | undefined;
  readonly pendingDiamondBorderChanges: readonly PendingDiamondBorderChange[];
  readonly spadeActivations: readonly SpadeActivation[];
  readonly events: readonly GameEvent[];
}
