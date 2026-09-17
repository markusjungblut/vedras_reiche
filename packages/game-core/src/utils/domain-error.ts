export enum DomainErrorCode {
  InvalidPhase = "INVALID_PHASE",
  InvalidPlayerOrder = "INVALID_PLAYER_ORDER",
  NotActivePlayer = "NOT_ACTIVE_PLAYER",
  TerritoryNotFound = "TERRITORY_NOT_FOUND",
  TerritoryNotOwned = "TERRITORY_NOT_OWNED",
  TerritoryNotActivated = "TERRITORY_NOT_ACTIVATED",
  TerritoryAlreadyActivated = "TERRITORY_ALREADY_ACTIVATED",
  InvalidSuitSelection = "INVALID_SUIT_SELECTION",
  InvalidActivationChoice = "INVALID_ACTIVATION_CHOICE",
  InvalidDevelopmentTarget = "INVALID_DEVELOPMENT_TARGET",
  InvalidLocalInfluenceTarget = "INVALID_LOCAL_INFLUENCE_TARGET",
  SecondSpecializationAlreadyExists = "SECOND_SPECIALIZATION_ALREADY_EXISTS",
  InvalidBorderTarget = "INVALID_BORDER_TARGET",
  BorderAlreadyMarked = "BORDER_ALREADY_MARKED",
  CardSourceRequired = "CARD_SOURCE_REQUIRED",
  InvalidDrawnCard = "INVALID_DRAWN_CARD",
  GlobalInfluenceUnavailable = "GLOBAL_INFLUENCE_UNAVAILABLE",
  UnsupportedAction = "UNSUPPORTED_ACTION",
  MaxRoundsReached = "MAX_ROUNDS_REACHED",
}

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message = code,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
