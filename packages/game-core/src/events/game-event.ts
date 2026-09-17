import type { GameEventId, PlayerId } from "../model/ids.js";

export enum GameEventType {
  GameCreated = "GAME_CREATED",
  PlayerAdded = "PLAYER_ADDED",
  RoundStarted = "ROUND_STARTED",
  StartPlayerSelected = "START_PLAYER_SELECTED",
  StartPlayerRotated = "START_PLAYER_ROTATED",
  ActivationNumbersRolled = "ACTIVATION_NUMBERS_ROLLED",
  ActivationPhaseStarted = "ACTIVATION_PHASE_STARTED",
  TerritoryActivationStarted = "TERRITORY_ACTIVATION_STARTED",
  TerritoryActivated = "TERRITORY_ACTIVATED",
  DiamondBorderMarked = "DIAMOND_BORDER_MARKED",
  DiamondNeutralBorderChangePending = "DIAMOND_NEUTRAL_BORDER_CHANGE_PENDING",
  ClubSettlementCreated = "CLUB_SETTLEMENT_CREATED",
  ClubCityCreated = "CLUB_CITY_CREATED",
  ClubActivationNumberAdded = "CLUB_ACTIVATION_NUMBER_ADDED",
  ClubSecondSuitAdded = "CLUB_SECOND_SUIT_ADDED",
  HeartGlobalInfluenceGained = "HEART_GLOBAL_INFLUENCE_GAINED",
  HeartLocalInfluenceAdded = "HEART_LOCAL_INFLUENCE_ADDED",
  SpadeActivationStored = "SPADE_ACTIVATION_STORED",
  ActivationPhaseFinished = "ACTIVATION_PHASE_FINISHED",
  ActionPhaseStarted = "ACTION_PHASE_STARTED",
  AuctionStarted = "AUCTION_STARTED",
  AuctionResolved = "AUCTION_RESOLVED",
  WarStarted = "WAR_STARTED",
  WarResolved = "WAR_RESOLVED",
  TerritorySplit = "TERRITORY_SPLIT",
  BorderChanged = "BORDER_CHANGED",
  GameFinished = "GAME_FINISHED",
}

/** Serializable event envelope. Payload schemas will be defined with their rules. */
export interface GameEvent<TPayload extends object = Readonly<Record<string, unknown>>> {
  readonly id: GameEventId;
  readonly type: GameEventType;
  /** ISO 8601 timestamp supplied by the caller, never read from a global clock here. */
  readonly timestamp: string;
  readonly actorId?: PlayerId;
  readonly payload: TPayload;
}
