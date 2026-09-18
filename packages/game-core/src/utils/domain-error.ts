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
  AuctionAlreadyActive = "AUCTION_ALREADY_ACTIVE",
  AuctionNotBidding = "AUCTION_NOT_BIDDING",
  AuctionNotFound = "AUCTION_NOT_FOUND",
  InvalidAuctionTarget = "INVALID_AUCTION_TARGET",
  NotEligibleBidder = "NOT_ELIGIBLE_BIDDER",
  BidAlreadySubmitted = "BID_ALREADY_SUBMITTED",
  InvalidBid = "INVALID_BID",
  BasicBidUnavailable = "BASIC_BID_UNAVAILABLE",
  InsufficientGlobalInfluence = "INSUFFICIENT_GLOBAL_INFLUENCE",
  InsufficientLocalInfluence = "INSUFFICIENT_LOCAL_INFLUENCE",
  PendingSplitRequired = "PENDING_SPLIT_REQUIRED",
  InvalidSplitResolution = "INVALID_SPLIT_RESOLUTION",
  InvalidStartAuctionState = "INVALID_START_AUCTION_STATE",
  NoEligibleStartTerritory = "NO_ELIGIBLE_START_TERRITORY",
  SecondAuctionUnavailable = "SECOND_AUCTION_UNAVAILABLE",
  ActionAlreadyCompleted = "ACTION_ALREADY_COMPLETED",
  LegalActionAvailable = "LEGAL_ACTION_AVAILABLE",
  PendingWarRequired = "PENDING_WAR_REQUIRED",
}

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
