import { DomainError, DomainErrorCode, GamePhase, MapCreationStage, getBreakthroughThreshold, getMinimumTerritoryArea, type GameState } from "@vedras/game-core";

export type RuleHelpId =
  | "overview" | "mapCreation" | "pois" | "territoryCards" | "factions" | "startAuctions"
  | "rounds" | "activation" | "diamonds" | "clubs" | "hearts" | "spades" | "auctions"
  | "war" | "borderGains" | "breakthrough" | "cutAndChoose" | "scoring";

export interface RuleHelpTopic {
  readonly id: RuleHelpId;
  readonly title: string;
  readonly short: string;
  readonly long: string;
  readonly keywords: readonly string[];
}

/** Player-facing rule copy only. Dynamic values are resolved separately from the live map. */
export const RULE_HELP: Readonly<Record<RuleHelpId, RuleHelpTopic>> = {
  overview: {
    id: "overview", title: "Überblick", short: "Gemeinsam Karte bauen, Gebiete erwerben und am Ende die höchste Wertung erreichen.",
    long: "Zuerst erschafft ihr die Karte. Danach werden Startgebiete versteigert. Jede Runde aktiviert ihr passende Gebietskarten und führt anschließend eine Grundaktion aus. Fläche, Entwicklungen, POIs und weitere Boni fließen in die Endwertung ein.", keywords: ["ziel", "ablauf", "runde", "gewinnen"],
  },
  mapCreation: {
    id: "mapCreation", title: "Kartenbau", short: "Ein bestätigter Zeichenzug teilt genau ein Gebiet in zwei zusammenhängende Gebiete.",
    long: "Zeichne mit dem Grenzstift eine Trennung auf dem Raster. Beide Teile müssen zusammenhängend bleiben und mindestens {minimumTerritoryArea} Kästchen haben. Der Radiergummi entfernt nur Linien aus deinem aktuellen Entwurf; Rückgängig entfernt den letzten Strich. Beim Bestätigen bleiben nur Linien erhalten, die tatsächlich die neue Gebietsgrenze bilden.", keywords: ["grenzstift", "radiergummi", "rückgängig", "teilen", "mindestgröße", "raster"],
  },
  pois: {
    id: "pois", title: "POIs", short: "Wahrzeichen, Knotenpunkte, Festungen und Relikte liegen auf einzelnen Rasterzellen.",
    long: "★ Wahrzeichen erhöhen die Wertung ihres Gebiets. ◎ Knotenpunkte richten ihren Bonus nach den angrenzenden Gebieten. ▲ Festungen zählen in der Verteidigung. ◆ Relikte werden für die Wertung aktiv, sobald du mindestens zwei kontrollierst. Ein POI bleibt auf seiner Zelle; nach einer Grenzänderung gehört er zu dem Gebiet dieser Zelle.", keywords: ["wahrzeichen", "knotenpunkt", "festung", "relikt", "poi", "stern", "dreieck"],
  },
  territoryCards: {
    id: "territoryCards", title: "Gebietskarten", short: "Jede Gebietskarte trägt eine Aktivierungszahl und ein Symbol.",
    long: "Die Zahl entscheidet, ob ein Gebiet in einer Runde aktiviert werden kann. Sein Symbol bestimmt die Fähigkeit. Durch ♣ kann eine Karte eine zweite Aktivierungszahl oder ein zweites Symbol erhalten. Gebietskarten bleiben beim Gebiet, sofern ein geregelter Teilungsablauf nichts anderes festlegt.", keywords: ["karte", "zahl", "symbol", "zweite zahl", "zweites symbol"],
  },
  factions: {
    id: "factions", title: "Fraktionen", short: "Deine geheime Fraktion belohnt Gebietskarten ihres ursprünglichen Symbols.",
    long: "In der Endwertung erhält jedes deiner Gebiete mit dem ursprünglichen Symbol deiner geheimen Fraktion +25 %. Die Fraktion ist persönliche Information und wird anderen Spielern nicht angezeigt.", keywords: ["geheim", "25", "prozent", "symbol", "wertung"],
  },
  startAuctions: {
    id: "startAuctions", title: "Startauktionen", short: "Startgebiete werden in getrennten, verdeckten Startauktionen vergeben.",
    long: "Die Startauktionen laufen vor der ersten Runde. Die aktuelle Auslage und die für dich verfügbaren Startgebote stehen im Aktionsbereich. Alle berechtigten Spieler geben ihr Gebot verdeckt ab; der Core deckt auf und löst das Ergebnis nach den Startauktionsregeln auf.", keywords: ["start", "gebot", "auslage", "verdeckt", "erste gebiete"],
  },
  rounds: {
    id: "rounds", title: "Runden", short: "Eine Runde besteht aus Aktivierung und anschließenden Grundaktionen.",
    long: "Zu Rundenbeginn werden Aktivierungszahlen bestimmt. In der Aktivierungsphase nutzt ihr passende eigene Gebietskarten. In der Aktionsphase führt der aktive Spieler eine Grundaktion aus: Auktion oder Krieg. Nach der letzten Runde startet die Wertung.", keywords: ["phase", "aktivierung", "aktion", "rundenende"],
  },
  activation: {
    id: "activation", title: "Aktivierung", short: "Nur eigene Karten mit einer aktuellen Aktivierungszahl sind aktivierbar.",
    long: "Zu Beginn der Runde werden drei Aktivierungszahlen bestimmt. Ein Gebiet kann aktiviert werden, wenn seine Karte mindestens eine davon trägt. Wähle danach das Symbol, dessen Fähigkeit du nutzen willst. Eine durch ♣ neu erhaltene zweite Zahl gilt erst ab der nächsten Runde.", keywords: ["zahlen", "würfel", "aktiv", "aktivierungsphase", "zweite zahl"],
  },
  diamonds: {
    id: "diamonds", title: "♦ Grenze", short: "♦ markiert Grenzen oder bereitet eine legale Verschiebung zu neutralem Gebiet vor.",
    long: "An einer gegnerischen Nachbarschaft setzt ♦ eine Grenzmarkierung. Bei neutralen Nachbarn kann ♦ bis zu zwei Rasterzellen entlang der gemeinsamen Grenze übernehmen. In jedem Fall prüft der Core Zusammenhang und die Mindestgröße von {minimumTerritoryArea} Kästchen.", keywords: ["diamant", "grenze", "neutral", "zellen", "markierung"],
  },
  clubs: {
    id: "clubs", title: "♣ Entwicklung", short: "♣ entwickelt ein eigenes Gebiet oder einen eigenen Nachbarn.",
    long: "Mit ♣ baust du eine Siedlung, wertest sie zur Stadt auf oder gibst einer Karte eine zweite Aktivierungszahl beziehungsweise ein zweites Symbol. Jede Karte kann nur eine dieser Spezialisierungen erhalten; der Core zeigt nur gültige Ziele an.", keywords: ["kreuz", "siedlung", "stadt", "entwicklung", "spezialisierung"],
  },
  hearts: {
    id: "hearts", title: "♥ Einfluss", short: "♥ gibt +1 globalen Einfluss oder +2 lokalen Einfluss auf einen neutralen Nachbarn.",
    long: "Globaler Einfluss gehört dem Spieler und kann in normalen Auktionen eingesetzt werden. Lokaler Einfluss liegt auf einem konkreten neutralen Nachbargebiet und zählt nur für dessen Auktion. Die Anzeige begrenzt beide Eingaben auf die Werte, die der Core zulässt.", keywords: ["herz", "global", "lokal", "einfluss", "neutral"],
  },
  spades: {
    id: "spades", title: "♠ Kriegsvorrat", short: "♠ speichert eine Fähigkeit für einen späteren Krieg in derselben Runde.",
    long: "Vor dem Kampf entscheiden beide Seiten verdeckt, ob sie verfügbare ♠-Effekte einsetzen. Erst wenn die Entscheidungen feststehen, wird der Kampf aufgelöst. Die Kriegsansicht zeigt dir nur deine legalen ♠-Optionen und ihren vom Core berechneten Bonus.", keywords: ["pik", "verdeckt", "kampf", "bonus", "speichern"],
  },
  auctions: {
    id: "auctions", title: "Normale Auktionen", short: "Alle berechtigten Spieler bieten verdeckt auf ein neutrales Nachbargebiet.",
    long: "Ein normales Gebot besteht aus Grundgebot, globalem Einfluss und lokalem Einfluss auf dieses Gebiet. Das Grundgebot folgt den verfügbaren Grundgeboten des Spielers; der Core verwaltet auch deren Rücksetzung. Nach allen Abgaben werden die Gebote gemeinsam aufgelöst.", keywords: ["grundgebot", "globaler einfluss", "lokaler einfluss", "bieten", "neutral"],
  },
  war: {
    id: "war", title: "Krieg", short: "Ein eigenes Gebiet greift ein angrenzendes gegnerisches Gebiet an.",
    long: "Beide Seiten können verdeckt verfügbare ♠-Effekte festlegen. Danach würfelt der Core und berücksichtigt ♠- sowie Festungsboni. Je nach Ergebnis endet der Krieg unentschieden, verschiebt eine Grenze, erobert ein Gebiet oder löst eine Teilung aus.", keywords: ["angriff", "verteidigung", "würfel", "festung", "geschwächt"],
  },
  borderGains: {
    id: "borderGains", title: "Grenzgewinn", short: "Nach einem passenden Kampfergebnis übernimmt der Gewinner Zellen entlang der gemeinsamen Grenze.",
    long: "Die Kartenansicht markiert den zulässigen Korridor. Du kannst darin Zellen auswählen; der Core prüft für beide Gebiete Zusammenhang und die Mindestgröße von {minimumTerritoryArea} Kästchen. Geschwächt bedeutet: Der gespeicherte Grenzverlauf ließ beim vorherigen Verlust keine ausreichende Fläche zurück. Verliert ein geschwächtes Gebiet später erneut, wird es vollständig erobert; ein eigener Sieg entfernt die Schwächung.", keywords: ["korridor", "geschwächt", "mindestfläche", "zellen", "vorstoß"],
  },
  breakthrough: {
    id: "breakthrough", title: "Durchbruch", short: "Bei großen Verlierergebieten kann ein Kampfergebnis eine Teilung auslösen.",
    long: "Die dynamische Durchbruchsschwelle dieser Karte liegt bei {cutAndChooseThreshold} Kästchen. Ab dieser Größe kann der Core statt einer vollständigen Eroberung Cut-and-Choose verlangen. Die tatsächliche Kriegsauflösung bleibt immer Sache des Cores.", keywords: ["schwelle", "groß", "teilung", "eroberung", "fläche"],
  },
  cutAndChoose: {
    id: "cutAndChoose", title: "Cut-and-Choose", short: "Eine Person teilt regelkonform, die andere wählt zuerst.",
    long: "Bei einer Auktion bestimmt der Core Divider und First Chooser aus dem Gleichstand und der Spielreihenfolge. Der Divider zieht eine gültige Teilung; der First Chooser wählt einen Teil. Im Krieg zieht der Gewinner die Grenze und der Verlierer wählt zuerst, welchen Teil er behält. Beide Teile brauchen mindestens {minimumTerritoryArea} Kästchen und müssen zusammenhängend sein.", keywords: ["teilung", "divider", "chooser", "gleichstand", "krieg", "auktion"],
  },
  scoring: {
    id: "scoring", title: "Wertung", short: "Am Ende werden Fläche und regelkonforme Boni je Gebiet addiert.",
    long: "Die Wertung zeigt pro Gebiet die Fläche und die einzelnen Bonusanteile: geheime Fraktion, größtes Reich, Entwicklungen und POIs. Bei Gleichständen um das größte Reich wählt der betroffene Spieler einen zulässigen Bereich. Die höchste Gesamtwertung gewinnt.", keywords: ["ende", "punkte", "fläche", "größtes reich", "boni", "sieg"],
  },
};

export const GLOSSARY: readonly { readonly term: string; readonly definition: string; readonly keywords: readonly string[] }[] = [
  { term: "Aktivierung", definition: "Die Nutzung einer eigenen Gebietskarte mit aktueller Aktivierungszahl.", keywords: ["zahlen", "runde"] },
  { term: "Grundgebot", definition: "Der feste Gebotsteil einer normalen Auktion. Verfügbare Werte verwaltet der Core.", keywords: ["auktion", "bieten"] },
  { term: "Globaler Einfluss", definition: "Spielerweiter Einfluss, der in normalen Auktionen eingesetzt werden kann.", keywords: ["herz", "gebot"] },
  { term: "Lokaler Einfluss", definition: "Einfluss auf genau einem neutralen Gebiet; er zählt nur in dessen Auktion.", keywords: ["herz", "gebot", "neutral"] },
  { term: "Geschwächt", definition: "Ein Gebiet, bei dem der vorherige Grenzverlust keine ausreichende Fläche zurückgelassen hätte. Ein späterer Verlust führt zur Eroberung.", keywords: ["krieg", "grenzgewinn"] },
  { term: "Durchbruch", definition: "Kampfergebnis, das bei ausreichender Gebietsgröße eine Teilung auslösen kann.", keywords: ["cut and choose", "krieg"] },
  { term: "Cut-and-Choose", definition: "Teilungsablauf: Eine Person teilt, die andere wählt zuerst.", keywords: ["divider", "chooser", "gleichstand"] },
  { term: "POI", definition: "Point of Interest: Wahrzeichen, Knotenpunkt, Festung oder Relikt auf einer Rasterzelle.", keywords: ["wahrzeichen", "festung", "relikt"] },
  { term: "Fraktion", definition: "Dein geheimes Symbol für den +25-%-Bonus auf Gebietskarten mit ihrem ursprünglichen Symbol.", keywords: ["geheim", "wertung"] },
];

export interface HelpValues { readonly minimumTerritoryArea: number; readonly cutAndChooseThreshold: number; }

export function getHelpValues(state: GameState): HelpValues {
  const map = state.map;
  return map === undefined
    ? { minimumTerritoryArea: 0, cutAndChooseThreshold: 0 }
    : { minimumTerritoryArea: getMinimumTerritoryArea(map), cutAndChooseThreshold: getBreakthroughThreshold(map) };
}

export function renderRuleHelp(topic: RuleHelpTopic, values: HelpValues): RuleHelpTopic {
  const render = (text: string) => text
    .replaceAll("{minimumTerritoryArea}", String(values.minimumTerritoryArea))
    .replaceAll("{cutAndChooseThreshold}", String(values.cutAndChooseThreshold));
  return { ...topic, short: render(topic.short), long: render(topic.long) };
}

function name(state: GameState, playerId: string | undefined): string {
  return state.players.find((player) => player.id === playerId)?.name ?? "Ein Spieler";
}

export interface CurrentHelp {
  readonly title: string;
  readonly action: string;
  readonly topicIds: readonly RuleHelpId[];
}

/** Reads only public phase and pending workflow state. It never derives game legality. */
export function getCurrentHelp(state: GameState, viewerPlayerId?: string): CurrentHelp {
  if (state.pendingSplit) {
    const choosing = state.pendingSplit.stage === "AWAITING_CHOICE";
    const responsible = choosing ? state.pendingSplit.firstChooserPlayerId : state.pendingSplit.dividerPlayerId;
    return { title: "Gebietsteilung", action: responsible === viewerPlayerId ? "Du bist jetzt für die Teilung zuständig." : `${name(state, responsible)} ist jetzt für die Teilung zuständig.`, topicIds: ["cutAndChoose", "auctions"] };
  }
  if (state.pendingWar) {
    const stage = state.pendingWar.stage;
    const action = stage === "AWAITING_COMBAT_CHOICES" ? "Die beteiligten Spieler legen ihre ♠-Entscheidung verdeckt fest."
      : stage === "AWAITING_BORDER_ADVANCE" ? "Der Kriegsgewinner wählt einen zulässigen Grenzgewinn auf der Karte."
        : stage === "AWAITING_CUT_DIVISION" ? "Der Kriegsgewinner teilt das Verlierergebiet in zwei gültige Teile."
          : stage === "AWAITING_CUT_CHOICE" ? "Der Kriegsverlierer wählt zuerst den Teil, den er behält."
            : "Der Besitzer der ♦-Markierung kann die Teilungsgrenze regelkonform korrigieren.";
    return { title: "Krieg", action, topicIds: stage.includes("CUT") ? ["war", "cutAndChoose", "breakthrough"] : ["war", "borderGains", "spades"] };
  }
  if (state.pendingDiamondBorderChanges.length > 0) return {
    title: "♦ Grenzverschiebung", action: "Wähle im markierten Korridor eine zulässige Grenze zum neutralen Gebiet.", topicIds: ["diamonds", "borderGains"],
  };
  if (state.auction) return {
    title: state.auction.kind === "START" ? "Startauktion" : "Normale Auktion",
    action: "Alle berechtigten Spieler geben ihr Gebot verdeckt ab. Danach löst der Core die Auktion auf.",
    topicIds: state.auction.kind === "START" ? ["startAuctions"] : ["auctions", "cutAndChoose"],
  };
  switch (state.phase) {
    case GamePhase.MapCreation: {
      const stage = state.mapCreation?.stage;
      if (stage && stage !== MapCreationStage.DrawTerritories && stage !== MapCreationStage.ReadyToFinalize) return {
        title: "Kartenbau · POIs", action: state.mapCreation?.activePlayerId === viewerPlayerId ? "Wähle eine freie Rasterzelle für den geforderten POI." : `${name(state, state.mapCreation?.activePlayerId)} platziert gerade einen POI.`, topicIds: ["pois", "mapCreation"],
      };
      return { title: "Kartenbau", action: state.mapCreation?.activePlayerId === viewerPlayerId ? "Zeichne eine Trennung, die genau ein Gebiet in zwei gültige Teile teilt." : `${name(state, state.mapCreation?.activePlayerId)} zeichnet gerade die nächste Trennung.`, topicIds: ["mapCreation", "pois"] };
    }
    case GamePhase.Setup: return { title: "Vorbereitung", action: "Die Karte ist fertig. Prüft eure persönlichen Fraktionen und startet danach die Startauktionen.", topicIds: ["factions", "startAuctions"] };
    case GamePhase.StartAuctions: return { title: "Startauktionen", action: "Eröffne die nächste Startauktion aus der aktuellen Auslage.", topicIds: ["startAuctions"] };
    case GamePhase.RoundReady: return { title: "Nächste Runde", action: "Starte die Runde; danach legt der Core die Aktivierungszahlen fest.", topicIds: ["rounds", "activation"] };
    case GamePhase.ActivationPhase: return { title: "Aktivierung", action: state.activePlayerId === viewerPlayerId ? "Wähle eines deiner vom Core freigegebenen Gebiete und nutze sein Symbol." : `${name(state, state.activePlayerId)} aktiviert gerade ein Gebiet.`, topicIds: ["activation", "diamonds", "clubs", "hearts", "spades"] };
    case GamePhase.ActionPhase: return { title: "Aktionsphase", action: state.activePlayerId === viewerPlayerId ? "Wähle eine vom Core angebotene Auktion oder einen Krieg." : `${name(state, state.activePlayerId)} führt gerade eine Grundaktion aus.`, topicIds: ["auctions", "war", "rounds"] };
    case GamePhase.Scoring: return { title: "Wertung", action: "Wähle bei Bedarf einen zulässigen größten Reichsbereich; danach rechnet der Core das Ergebnis aus.", topicIds: ["scoring", "factions", "pois"] };
    case GamePhase.Finished: return { title: "Partie beendet", action: "Die Endwertung zeigt alle Punkte und den Sieger.", topicIds: ["scoring", "overview"] };
  }
}

const DOMAIN_MESSAGES: Partial<Record<DomainErrorCode, string>> = {
  [DomainErrorCode.NotActivePlayer]: "Du bist für diese Aktion gerade nicht an der Reihe.",
  [DomainErrorCode.InvalidPhase]: "Diese Aktion ist in der aktuellen Phase nicht verfügbar.",
  [DomainErrorCode.TerritoryNotOwned]: "Dieses Gebiet gehört nicht dem handelnden Spieler.",
  [DomainErrorCode.TerritoryNotActivated]: "Dieses Gebiet ist in dieser Runde nicht aktiviert.",
  [DomainErrorCode.TerritoryAlreadyActivated]: "Dieses Gebiet wurde in dieser Runde bereits aktiviert.",
  [DomainErrorCode.InvalidActivationChoice]: "Diese Symbolfähigkeit kann hier nicht eingesetzt werden.",
  [DomainErrorCode.InvalidDevelopmentTarget]: "Dieses Gebiet kann dafür nicht entwickelt werden.",
  [DomainErrorCode.InvalidLocalInfluenceTarget]: "Lokaler Einfluss ist nur auf einem zulässigen neutralen Nachbargebiet möglich.",
  [DomainErrorCode.SecondSpecializationAlreadyExists]: "Diese Karte hat bereits eine zusätzliche Spezialisierung.",
  [DomainErrorCode.InvalidBorderTarget]: "Diese Grenze ist für diese Fähigkeit nicht zulässig.",
  [DomainErrorCode.BorderAlreadyMarked]: "Diese Grenze trägt bereits eine ♦-Markierung.",
  [DomainErrorCode.InvalidBid]: "Dieses Gebot entspricht nicht den aktuellen Auktionsregeln.",
  [DomainErrorCode.BasicBidUnavailable]: "Dieses Grundgebot steht dir gerade nicht zur Verfügung.",
  [DomainErrorCode.InsufficientGlobalInfluence]: "Dafür ist nicht genug globaler Einfluss verfügbar.",
  [DomainErrorCode.InsufficientLocalInfluence]: "Dafür ist nicht genug lokaler Einfluss auf diesem Gebiet verfügbar.",
  [DomainErrorCode.MinimumTerritorySizeViolated]: "Das Gebiet wäre anschließend kleiner als die erlaubte Mindestgröße.",
  [DomainErrorCode.TerritoryDisconnected]: "Die gewählte Veränderung würde ein Gebiet auseinanderreißen.",
  [DomainErrorCode.InvalidBorderAdvance]: "Dieser Grenzgewinn ist nicht zulässig.",
  [DomainErrorCode.CellOutsideWarCorridor]: "Diese Zelle liegt außerhalb des zulässigen Grenzkorridors.",
  [DomainErrorCode.InvalidWarTarget]: "Diese Gebiete können keinen Krieg gegeneinander führen.",
  [DomainErrorCode.InvalidSpadeActivation]: "Dieser ♠-Effekt steht in diesem Krieg nicht zur Verfügung.",
  [DomainErrorCode.SpadeChoiceAlreadyLocked]: "Deine ♠-Entscheidung ist bereits verdeckt festgelegt.",
  [DomainErrorCode.InvalidSplitResolution]: "Diese Teilung entspricht nicht den aktuellen Vorgaben.",
  [DomainErrorCode.InvalidSetupBoundaryDraft]: "Dieser Grenzentwurf teilt nicht genau ein Gebiet regelkonform.",
  [DomainErrorCode.InvalidPoiPlacement]: "Dieser POI kann auf dieser Zelle oder in dieser Etappe nicht platziert werden.",
};

export function formatDomainError(error: unknown): string {
  if (error instanceof DomainError) return DOMAIN_MESSAGES[error.code] ?? "Diese Aktion ist im aktuellen Zustand nicht verfügbar.";
  return error instanceof Error ? error.message : String(error);
}
