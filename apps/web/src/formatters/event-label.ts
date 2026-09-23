import { GameEventType, type GameEvent, type AuctionBid } from "@vedras/game-core";

type PlayerName = (id: string) => string;

function field(event: GameEvent, key: string): string {
  const value = event.payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "?";
}

function named(event: GameEvent, key: string, playerName: PlayerName): string {
  const id = field(event, key);
  return id === "?" ? id : playerName(id);
}

function cellCount(event: GameEvent, key: string): number {
  return Array.isArray(event.payload[key]) ? event.payload[key].length : 0;
}

function revealedBids(event: GameEvent, playerName: PlayerName): string {
  const raw = event.payload.bids;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return "Alle Gebote wurden aufgedeckt.";
  }
  const bids = Object.entries(raw as Record<string, AuctionBid>)
    .map(([id, bid]) => {
      if (bid === null || typeof bid !== "object") return playerName(id);
      const value = bid.kind === "START"
        ? bid.value
        : bid.basicBid + bid.globalInfluence + bid.localInfluence;
      return `${playerName(id)}: ${value}`;
    });
  return bids.length > 0 ? `Gebote aufgedeckt: ${bids.join(" · ")}.` : "Alle Gebote wurden aufgedeckt.";
}

/** Formats only recorded core events. Current private bids have no value in the submission event. */
export function eventLabel(event: GameEvent, playerName: PlayerName): string {
  switch (event.type) {
    case GameEventType.MapCreationStarted: return "Kartenbau begonnen.";
    case GameEventType.SetupBoundaryCommitted: return `Grenze bestätigt: ${field(event, "regionCount")} Regionen.`;
    case GameEventType.SetupBordersCorrected: return "Setup-Grenze korrigiert.";
    case GameEventType.PoiPlacementStarted: return "Platzierung Strategischer Punkte beginnt.";
    case GameEventType.PoiPlaced: return "Strategischer Punkt auf der Karte platziert.";
    case GameEventType.MapCreationCompleted: return "Karte erfolgreich geprüft.";
    case GameEventType.TerritoryCardsAssigned: return "Gebietskarten verteilt.";
    case GameEventType.SecretFactionsAssigned: return "Geheime Fraktionen vergeben.";
    case GameEventType.SetupCompleted: return "Spielaufbau abgeschlossen.";
    case GameEventType.GameCreated: return "Spiel erstellt.";
    case GameEventType.PlayerAdded: return `${named(event, "playerId", playerName)} nimmt teil.`;
    case GameEventType.RoundStarted: return `Runde ${field(event, "round")} beginnt.`;
    case GameEventType.StartPlayerSelected: return `${named(event, "playerId", playerName)} ist Startspieler.`;
    case GameEventType.StartPlayerRotated: return `Startspieler: ${named(event, "playerId", playerName)}.`;
    case GameEventType.ActivationNumbersRolled: {
      const numbers = event.payload.activationNumbers ?? event.payload.numbers;
      return Array.isArray(numbers) ? `Aktivierungszahlen: ${numbers.join(", ")}.` : "Aktivierungszahlen gewürfelt.";
    }
    case GameEventType.ActivationPhaseStarted: return "Aktivierungsphase beginnt.";
    case GameEventType.TerritoryActivationStarted: return `${named(event, "playerId", playerName)} aktiviert ${field(event, "territoryId")}.`;
    case GameEventType.TerritoryActivated: return `${field(event, "territoryId")} wurde aktiviert.`;
    case GameEventType.DiamondBorderMarked: return `♦ Grenze bei ${field(event, "territoryId")} und ${field(event, "targetTerritoryId")} markiert.`;
    case GameEventType.DiamondNeutralBorderChangePending: return `♦ Grenze von ${field(event, "territoryId")} zu ${field(event, "targetTerritoryId")} wird gezeichnet.`;
    case GameEventType.ClubSettlementCreated: return `♣ Siedlung auf ${field(event, "targetTerritoryId")} errichtet.`;
    case GameEventType.ClubCityCreated: return `♣ ${field(event, "targetTerritoryId")} zur Stadt ausgebaut.`;
    case GameEventType.ClubActivationNumberAdded: return `♣ ${field(event, "targetTerritoryId")} erhält Aktivierungszahl ${field(event, "activationNumber")}.`;
    case GameEventType.ClubSecondSuitAdded: return `♣ ${field(event, "targetTerritoryId")} erhält ein zweites Symbol.`;
    case GameEventType.HeartGlobalInfluenceGained: return `${named(event, "playerId", playerName)} erhält ${field(event, "amount")} globalen Einfluss.`;
    case GameEventType.HeartLocalInfluenceAdded: return `${named(event, "playerId", playerName)} platziert ${field(event, "amount")} lokalen Einfluss auf ${field(event, "targetTerritoryId")}.`;
    case GameEventType.SpadeActivationStored: return `♠ Aktivierung von ${field(event, "territoryId")} gespeichert.`;
    case GameEventType.ActivationPhaseFinished: return "Aktivierungsphase beendet.";
    case GameEventType.ActionPhaseStarted: return "Aktionsphase beginnt.";
    case GameEventType.StartAuctionRoundStarted: return `Startauktionsrunde ${field(event, "round")} beginnt.`;
    case GameEventType.StartAuctionDisplayCreated: return "Neue Auslage für die Startauktionen gezogen.";
    case GameEventType.AuctionOpened: return `${event.actorId ? playerName(event.actorId) : "Ein Spieler"} eröffnet eine Auktion um ${field(event, "territoryId")}.`;
    case GameEventType.AuctionBidSubmitted: return `${named(event, "playerId", playerName)} hat verdeckt geboten.`;
    case GameEventType.AuctionBidsRevealed: return revealedBids(event, playerName);
    case GameEventType.AuctionWon: {
      const winnerId = event.payload.winnerId ?? event.payload.playerId;
      return `${typeof winnerId === "string" ? playerName(winnerId) : "Ein Spieler"} gewinnt ${field(event, "territoryId")}.`;
    }
    case GameEventType.AuctionTiedTwoPlayers: return `Zweiergleichstand bei ${field(event, "territoryId")}.`;
    case GameEventType.AuctionTiedMultiplePlayers: return `Gleichstand von mindestens drei Spielern bei ${field(event, "territoryId")}.`;
    case GameEventType.TerritorySplitRequired: return `Gebietsteilung bei ${field(event, "territoryId")} erforderlich.`;
    case GameEventType.TerritorySplitResolved: return event.payload.resolution === "SPLIT_NOT_POSSIBLE"
      ? "Gebietsteilung als nicht möglich aufgelöst."
      : "Gebietsteilung abgeschlossen.";
    case GameEventType.TerritoryOwnerChanged: return `${field(event, "territoryId")} gehört jetzt ${named(event, "ownerId", playerName)}.`;
    case GameEventType.AuctionResolved: return "Auktion abgeschlossen.";
    case GameEventType.StartBidRefreshed: return `${named(event, "playerId", playerName)} erhält seine Startgebote zurück.`;
    case GameEventType.BasicBidExhausted: return `Grundgebot ${field(event, "basicBid")} von ${named(event, "playerId", playerName)} erschöpft.`;
    case GameEventType.BasicBidsRefreshed: return `Grundgebote von ${named(event, "playerId", playerName)} erneuert.`;
    case GameEventType.GlobalInfluenceSpent: return `${named(event, "playerId", playerName)} bezahlt ${field(event, "amount")} globalen Einfluss.`;
    case GameEventType.LocalInfluenceSpent: return `${named(event, "playerId", playerName)} bezahlt ${field(event, "amount")} lokalen Einfluss.`;
    case GameEventType.LocalInfluenceCleared: return `Lokaler Einfluss auf ${field(event, "territoryId")} entfernt.`;
    case GameEventType.SecondAuctionAvailable: return "Eine zweite Auktion ist möglich.";
    case GameEventType.ActionCompleted: return `${named(event, "playerId", playerName)} hat die Grundaktion beendet.`;
    case GameEventType.ActionForfeited: return `${named(event, "playerId", playerName)} setzt die Grundaktion aus.`;
    case GameEventType.ActionPhaseFinished: return "Aktionsphase beendet.";
    case GameEventType.RoundFinished: return `Runde ${field(event, "round")} beendet.`;
    case GameEventType.ScoringStarted: return "Wertung beginnt.";
    case GameEventType.LargestRealmChoiceRequired: return `${named(event, "playerId", playerName)} wählt das größte Reich.`;
    case GameEventType.LargestRealmSelected: return `${named(event, "playerId", playerName)} hat ein größtes Reich gewählt.`;
    case GameEventType.ScoringCompleted: return "Endwertung abgeschlossen.";
    case GameEventType.WarStarted: return `Krieg zwischen ${field(event, "attackerTerritoryId")} und ${field(event, "defenderTerritoryId")} begonnen.`;
    case GameEventType.WarSpadeChoiceLocked: return `${named(event, "playerId", playerName)} hat die ♠-Wahl bestätigt.`;
    case GameEventType.CombatRolled: return `Kampf: Angreifer ${field(event, "attackerRoll")} + ♠ ${field(event, "attackerSpadeBonus")} = ${field(event, "attackerTotal")}; Verteidiger ${field(event, "defenderRoll")} + ♠ ${field(event, "defenderSpadeBonus")} + Festungen ${field(event, "defenderFortressBonus")} = ${field(event, "defenderTotal")}. Differenz ${field(event, "difference")}.`;
    case GameEventType.SpadeActivationUsed: return "♠-Aktivierung eingesetzt.";
    case GameEventType.BorderAdvanceRequired: return `Grenzgewinn bis ${field(event, "maximumDepth")} Kästchen Tiefe möglich.`;
    case GameEventType.BorderAdvanceResolved: {
      const annexed = cellCount(event, "annexedDisconnectedCells");
      return annexed === 0 ? "Grenzverschiebung bestätigt."
        : `Grenzverschiebung bestätigt; ${annexed} abgeschnittene Kästchen fallen ebenfalls an den Gewinner.`;
    }
    case GameEventType.TerritoryWeakened: return `${field(event, "territoryId")} wurde geschwächt.`;
    case GameEventType.TerritoryWeakeningRemoved: return `Schwächung von ${field(event, "territoryId")} entfernt.`;
    case GameEventType.TerritoryConquered: return `${field(event, "territoryId")} wurde vollständig von ${named(event, "ownerId", playerName)} erobert.`;
    case GameEventType.WarCutRequired: return "Durchbruch: Gewinner zieht eine Teilungsgrenze.";
    case GameEventType.WarCutProposed: return "Teilung des besiegten Gebiets vorgeschlagen.";
    case GameEventType.WarCutChoiceMade: return "Verlierer hat seinen Gebietsteil gewählt.";
    case GameEventType.DiamondBorderMarkConsumed: return "♦-Grenzmarkierung verbraucht.";
    case GameEventType.DiamondCutCorrectionRequired: return "♦-Korrektur der Teilungsgrenze möglich.";
    case GameEventType.DiamondCutCorrectionResolved: return cellCount(event, "annexedDisconnectedCells") === 0
      ? "♦-Korrektur abgeschlossen."
      : `♦-Korrektur abgeschlossen; ${cellCount(event, "annexedDisconnectedCells")} abgeschnittene Kästchen wurden annektiert.`;
    case GameEventType.DiamondNeutralBorderChanged: return cellCount(event, "annexedDisconnectedCells") === 0
      ? "♦-Grenzverschiebung zum neutralen Gebiet abgeschlossen."
      : `♦-Grenzverschiebung abgeschlossen; ${cellCount(event, "annexedDisconnectedCells")} abgeschnittene Kästchen wurden annektiert.`;
    case GameEventType.WarResolved: {
      const outcome = field(event, "outcome");
      const labels: Record<string, string> = { TIE: "Gleichstand", BORDER_ADVANCE: "Grenzgewinn",
        STRONG_ADVANCE: "starker Vorstoß", CONQUEST: "Eroberung", CUT_AND_CHOOSE: "Gebietsteilung" };
      return `Krieg abgeschlossen: ${labels[outcome] ?? outcome}.`;
    }
    case GameEventType.TerritorySplit: return "Gebiet geteilt.";
    case GameEventType.BorderChanged: return "Grenze geändert.";
    case GameEventType.GameFinished: return "Spiel beendet.";
    case GameEventType.AuctionStarted: return "Auktion begonnen.";
    case GameEventType.TerritorySplitProposed: return "Grenzteilung vorgeschlagen.";
    case GameEventType.TerritorySplitChoiceMade: return "Teil der Gebietsteilung gewählt.";
    case GameEventType.MapGeometryChanged: return "Kartengeometrie aktualisiert.";
  }
}
