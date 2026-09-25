import { DomainError, DomainErrorCode, GamePhase, MapCreationStage, PointOfInterestType, getBreakthroughThreshold, getMinimumTerritoryArea, getNeutralDiamondDepth, scaleGridDepth } from "@vedras/game-core";
import type { GameReadModel } from "../game-read-model";
import { getPointOfInterestPresentation, POINT_OF_INTEREST_RULE_SUMMARY } from "../ui/point-of-interest-presentation.js";

export type RuleHelpId =
  | "overview" | "mapCreation" | "pois" | "territoryCards" | "factions" | "startAuctions"
  | "rounds" | "activation" | "diamonds" | "clubs" | "hearts" | "spades" | "auctions"
  | "war" | "borderGains" | "breakthrough" | "cutAndChoose" | "frontTerritory" | "scoring";

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
    long: "Zuerst erschafft ihr die Karte. Danach werden Startgebiete versteigert. In jeder Runde löst jede Person zuerst ihre passenden Gebietskarten aus und führt direkt danach eine Grundaktion aus. Fläche, Entwicklungen, Strategische Punkte und weitere Boni fließen in die Endwertung ein.", keywords: ["ziel", "ablauf", "runde", "gewinnen"],
  },
  mapCreation: {
    id: "mapCreation", title: "Kartenbau", short: "Ein bestätigter Zeichenzug teilt genau ein Gebiet in zwei zusammenhängende Gebiete.",
    long: "Zeichne mit dem Grenzstift eine Trennung auf dem Raster. Beide Teile müssen zusammenhängend bleiben und mindestens {minimumTerritoryArea} Kästchen haben. Der Radiergummi entfernt nur Linien aus deinem aktuellen Entwurf; Rückgängig entfernt den letzten Strich. Beim Bestätigen bleiben nur Linien erhalten, die tatsächlich die neue Gebietsgrenze bilden.", keywords: ["grenzstift", "radiergummi", "rückgängig", "teilen", "mindestgröße", "raster"],
  },
  pois: {
    id: "pois", title: "Strategische Punkte", short: "Wahrzeichen, Knotenpunkte, Festungen und Relikte liegen auf einzelnen Rasterzellen.",
    long: `${POINT_OF_INTEREST_RULE_SUMMARY} Ein Strategischer Punkt bleibt auf seiner Zelle; nach einer Grenzänderung gehört er zu dem Gebiet dieser Zelle.`, keywords: ["wahrzeichen", "knotenpunkt", "festung", "relikt", "strategische punkte", "stern", "dreieck"],
  },
  territoryCards: {
    id: "territoryCards", title: "Gebietskarten", short: "Jede Gebietskarte trägt eine Aktivierungszahl und ein Symbol.",
    long: "Die Zahl entscheidet, ob ein Gebiet in einer Runde aktiviert werden kann. Sein Symbol bestimmt die Fähigkeit. Durch ♣ kann eine Karte eine zweite Aktivierungszahl oder ein zweites Symbol erhalten. Gebietskarten bleiben beim Gebiet, sofern ein geregelter Teilungsablauf nichts anderes festlegt.", keywords: ["karte", "zahl", "symbol", "zweite zahl", "zweites symbol"],
  },
  factions: {
    id: "factions", title: "Fraktionen", short: "Deine geheime Fraktion belohnt Gebietskarten ihres ursprünglichen Symbols.",
    long: "In der Endwertung erhält jedes deiner Gebiete mit dem ursprünglichen Symbol deiner geheimen Fraktion +30 %. Die Fraktion ist persönliche Information und wird anderen Spielern nicht angezeigt.", keywords: ["geheim", "30", "prozent", "symbol", "wertung"],
  },
  startAuctions: {
    id: "startAuctions", title: "Startauktionen", short: "Startgebiete werden in getrennten, verdeckten Startauktionen vergeben.",
    long: "Die Startauktionen laufen vor der ersten Runde automatisch weiter. Die aktuelle Auslage und deine verfügbaren Startgebote stehen im Aktionsbereich. Alle berechtigten Spieler geben ihr Gebot verdeckt und unabhängig voneinander ab; nach der letzten Abgabe deckt der Core auf, löst das Ergebnis auf und öffnet die nächste Auktion.", keywords: ["start", "gebot", "auslage", "verdeckt", "erste gebiete"],
  },
  rounds: {
    id: "rounds", title: "Runden", short: "Eine Runde besteht aus Aktivierung und anschließenden Grundaktionen.",
    long: "Zu Rundenbeginn bestimmt der Startspieler nacheinander drei Aktivierungszahlen. Nach jeder Zahl werden alle passenden, noch nicht aktivierten Gebiete vollständig abgehandelt. Erst danach beginnt die Aktionsphase: In Spielerreihenfolge führt jede Person genau eine Grundaktion aus, Auktion oder Krieg. Nach der letzten Runde startet die Wertung.", keywords: ["phase", "aktivierung", "aktion", "rundenende"],
  },
  activation: {
    id: "activation", title: "Aktivierung", short: "Nur eigene Karten mit einer aktuellen Aktivierungszahl sind aktivierbar.",
    long: "Der Startspieler bestimmt drei verschiedene Aktivierungszahlen einzeln. Nach jeder Zahl werden nur die bei diesem Wurf passenden, noch nicht aktivierten Gebiete abgehandelt. Ein Gebiet kann höchstens einmal pro Runde aktiviert werden. Eine durch ♣ neu erhaltene zweite Zahl gilt für spätere Würfe derselben Runde, aber nicht rückwirkend für vergangene oder bereits laufende Würfe.", keywords: ["zahlen", "würfel", "aktiv", "aktivierungsphase", "zweite zahl"],
  },
  diamonds: {
    id: "diamonds", title: "♦ Grenze", short: "♦ markiert Grenzen oder bereitet eine legale Verschiebung zu neutralem Gebiet vor.",
    long: "An einer gegnerischen Nachbarschaft setzt ♦ eine Grenzmarkierung. Bei neutralen Nachbarn kann ♦ bis zu {neutralDiamondDepth} Rasterzellen entlang der gemeinsamen Grenze übernehmen. Auf größeren Karten reicht die Verschiebung entsprechend weiter. In jedem Fall prüft der Core Zusammenhang und die Mindestgröße von {minimumTerritoryArea} Kästchen.", keywords: ["diamant", "grenze", "neutral", "zellen", "markierung"],
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
    long: "Ein normales Gebot besteht aus Grundgebot, globalem Einfluss und lokalem Einfluss auf dieses Gebiet. Das Grundgebot folgt den verfügbaren Grundgeboten des Spielers; der Core verwaltet auch deren Rücksetzung. Nach allen Abgaben werden die Gebote gemeinsam aufgelöst. Bei einem unaufgelösten Höchstgleichstand bleibt das Gebiet neutral. Die beteiligten Höchstbieter erschöpfen ihr verwendetes Grundgebot, eingesetzter Einfluss wird aber nicht bezahlt.", keywords: ["grundgebot", "globaler einfluss", "lokaler einfluss", "bieten", "neutral"],
  },
  war: {
    id: "war", title: "Krieg", short: "Ein eigenes Gebiet greift ein angrenzendes gegnerisches Gebiet an.",
    long: "Beide Seiten können verdeckt verfügbare ♠-Effekte festlegen. Danach würfelt der Core und berücksichtigt ♠- sowie Festungsboni. Normale Gebiete können pro Runde an einem Krieg beteiligt sein. Großgebiete ab 6 % der Kartenfläche können an zwei Kriegen beteiligt sein, aber nur einen davon selbst beginnen. Je nach Ergebnis endet der Krieg unentschieden, verschiebt eine Grenze, erobert ein Gebiet oder löst eine Teilung aus.", keywords: ["angriff", "verteidigung", "würfel", "festung", "geschwächt", "großgebiet"],
  },
  borderGains: {
    id: "borderGains", title: "Grenzgewinn", short: "Nach einem passenden Kampfergebnis übernimmt der Gewinner Zellen entlang der gemeinsamen Grenze.",
    long: "Die Kartenansicht markiert den zulässigen Korridor. Ein normaler Grenzgewinn reicht auf dieser Karte bis zu {normalAdvanceDepth} Kästchen tief, ein starker Vorstoß bis zu {strongAdvanceDepth}. Du kannst darin Zellen auswählen; der Core prüft für beide Gebiete Zusammenhang und die Mindestgröße von {minimumTerritoryArea} Kästchen. Trennt die Verschiebung einen kleineren Teil ab, fällt er automatisch an das gewinnende Gebiet, damit jedes Gebiet zusammenhängend bleibt. Geschwächt bedeutet: Der gespeicherte Grenzverlauf ließ beim vorherigen Verlust keine ausreichende Fläche zurück. Verliert ein geschwächtes Gebiet später erneut, wird es vollständig erobert; ein eigener Sieg entfernt die Schwächung.", keywords: ["korridor", "geschwächt", "mindestfläche", "zellen", "vorstoß"],
  },
  breakthrough: {
    id: "breakthrough", title: "Durchbruch", short: "Bei großen Verlierergebieten kann ein Kampfergebnis eine Teilung auslösen.",
    long: "Die dynamische Durchbruchsschwelle dieser Karte liegt bei {cutAndChooseThreshold} Kästchen. Ab dieser Größe kann der Core statt einer vollständigen Eroberung Cut-and-Choose verlangen. Die tatsächliche Kriegsauflösung bleibt immer Sache des Cores.", keywords: ["schwelle", "groß", "teilung", "eroberung", "fläche"],
  },
  cutAndChoose: {
    id: "cutAndChoose", title: "Cut-and-Choose", short: "Eine Person teilt regelkonform, die andere wählt zuerst.",
    long: "Bei einer Auktion bestimmt der Core Divider und First Chooser aus dem Gleichstand und der Spielreihenfolge. Der Divider zieht eine gültige Teilung; der First Chooser wählt einen Teil. Im Krieg zieht der Gewinner die Grenze und der Verlierer wählt zuerst, welchen Teil er behält. Beide Teile brauchen mindestens {minimumTerritoryArea} Kästchen und müssen zusammenhängend sein.", keywords: ["teilung", "divider", "chooser", "gleichstand", "krieg", "auktion"],
  },
  frontTerritory: {
    id: "frontTerritory", title: "Frontgebiet", short: "Kleine Gebiete an gegnerischen Grenzen erhalten am Spielende einen Bonus.",
    long: "Ein Gebiet mit höchstens 3 % der gesamten Kartenfläche erhält bei Spielende +20 % je unterschiedlichem angrenzenden gegnerischen Gebiet. Eigene und neutrale Gebiete zählen nicht. Der Bonus wird nur bei der Endwertung aus der aktuellen Karte bestimmt.", keywords: ["front", "gegner", "grenze", "20", "prozent", "wertung"],
  },
  scoring: {
    id: "scoring", title: "Wertung", short: "Am Ende werden Fläche und regelkonforme Boni je Gebiet addiert.",
    long: "Die Wertung zeigt pro Gebiet die Fläche und die einzelnen Bonusanteile: geheime Fraktion, größtes Reich, Entwicklungen, Strategische Punkte und Frontgebiet. Bei Gleichständen um das größte Reich wählt der betroffene Spieler einen zulässigen Bereich. Jeder verbleibende globale Einfluss ist 10 Punkte wert; lokaler Einfluss wird nicht gewertet. Die höchste Gesamtwertung gewinnt.", keywords: ["ende", "punkte", "fläche", "größtes reich", "frontgebiet", "globaler einfluss", "boni", "sieg"],
  },
};

export const GLOSSARY: readonly { readonly term: string; readonly definition: string; readonly keywords: readonly string[] }[] = [
  { term: "Aktivierung", definition: "Die Nutzung einer eigenen Gebietskarte mit aktueller Aktivierungszahl.", keywords: ["zahlen", "runde"] },
  { term: "Grundgebot", definition: "Der feste Gebotsteil einer normalen Auktion. Verfügbare Werte verwaltet der Core.", keywords: ["auktion", "bieten"] },
  { term: "Globaler Einfluss", definition: "Spielerweiter Einfluss, der in normalen Auktionen eingesetzt werden kann und am Spielende je 10 Punkte wert ist.", keywords: ["herz", "gebot", "wertung"] },
  { term: "Lokaler Einfluss", definition: "Einfluss auf genau einem neutralen Gebiet; er zählt nur in dessen Auktion und wird am Spielende nicht gewertet.", keywords: ["herz", "gebot", "neutral", "wertung"] },
  { term: "Frontgebiet", definition: "Ein Gebiet mit höchstens 3 % der Kartenfläche erhält bei der Endwertung +20 % je unterschiedlichem angrenzenden gegnerischen Gebiet.", keywords: ["front", "gegner", "grenze", "wertung"] },
  { term: "Geschwächt", definition: "Ein Gebiet, bei dem der vorherige Grenzverlust keine ausreichende Fläche zurückgelassen hätte. Ein späterer Verlust führt zur Eroberung.", keywords: ["krieg", "grenzgewinn"] },
  { term: "Durchbruch", definition: "Kampfergebnis, das bei ausreichender Gebietsgröße eine Teilung auslösen kann.", keywords: ["cut and choose", "krieg"] },
  { term: "Cut-and-Choose", definition: "Teilungsablauf: Eine Person teilt, die andere wählt zuerst.", keywords: ["divider", "chooser", "gleichstand"] },
  { term: "Strategischer Punkt", definition: "Wahrzeichen, Knotenpunkt, Festung oder Relikt auf einer Rasterzelle.", keywords: ["wahrzeichen", "festung", "relikt"] },
  { term: "Fraktion", definition: "Dein geheimes Symbol für den +30-%-Bonus auf Gebietskarten mit ihrem ursprünglichen Symbol.", keywords: ["geheim", "wertung"] },
];

export interface HelpValues {
  readonly minimumTerritoryArea: number;
  readonly cutAndChooseThreshold: number;
  readonly neutralDiamondDepth: number;
  readonly normalAdvanceDepth: number;
  readonly strongAdvanceDepth: number;
}

export function getHelpValues(state: GameReadModel): HelpValues {
  const map = state.map;
  return map === undefined
    ? { minimumTerritoryArea: 0, cutAndChooseThreshold: 0, neutralDiamondDepth: 0, normalAdvanceDepth: 0, strongAdvanceDepth: 0 }
    : {
      minimumTerritoryArea: getMinimumTerritoryArea(map), cutAndChooseThreshold: getBreakthroughThreshold(map),
      neutralDiamondDepth: getNeutralDiamondDepth(map), normalAdvanceDepth: scaleGridDepth(2, map), strongAdvanceDepth: scaleGridDepth(4, map),
    };
}

export function renderRuleHelp(topic: RuleHelpTopic, values: HelpValues): RuleHelpTopic {
  const render = (text: string) => text
    .replaceAll("{minimumTerritoryArea}", String(values.minimumTerritoryArea))
    .replaceAll("{cutAndChooseThreshold}", String(values.cutAndChooseThreshold))
    .replaceAll("{neutralDiamondDepth}", String(values.neutralDiamondDepth))
    .replaceAll("{normalAdvanceDepth}", String(values.normalAdvanceDepth))
    .replaceAll("{strongAdvanceDepth}", String(values.strongAdvanceDepth));
  return { ...topic, short: render(topic.short), long: render(topic.long) };
}

function name(state: GameReadModel, playerId: string | undefined): string {
  return state.players.find((player) => player.id === playerId)?.name ?? "Ein Spieler";
}

export interface CurrentHelp {
  readonly title: string;
  readonly action: string;
  readonly topicIds: readonly RuleHelpId[];
}

/** Reads only public phase and pending workflow state. It never derives game legality. */
export function getCurrentHelp(state: GameReadModel, viewerPlayerId?: string): CurrentHelp {
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
      if (stage && stage !== MapCreationStage.DrawTerritories && stage !== MapCreationStage.ReadyToFinalize) {
        const poiTypeByStage = {
          [MapCreationStage.PlaceLandmarks]: PointOfInterestType.Landmark,
          [MapCreationStage.PlaceJunctions]: PointOfInterestType.Junction,
          [MapCreationStage.PlaceFortresses]: PointOfInterestType.Fortress,
          [MapCreationStage.PlaceRelics]: PointOfInterestType.Relic,
        } as const;
        const poiType = poiTypeByStage[stage as keyof typeof poiTypeByStage];
        const presentation = poiType === undefined ? undefined : getPointOfInterestPresentation(poiType);
        return {
          title: presentation === undefined ? "Kartenbau · Strategische Punkte" : `Kartenbau · ${presentation.symbol} ${presentation.name}`,
          action: state.mapCreation?.activePlayerId === viewerPlayerId
            ? `${presentation?.shortEffect ?? ""} ${presentation?.placementHint ?? "Wähle eine freie Rasterzelle für den geforderten Strategischen Punkt."}`.trim()
            : `${name(state, state.mapCreation?.activePlayerId)} platziert gerade ${presentation === undefined ? "einen Strategischen Punkt" : `ein ${presentation.name}`}.`,
          topicIds: ["pois", "mapCreation"],
        };
      }
      return { title: "Kartenbau", action: state.mapCreation?.activePlayerId === viewerPlayerId ? "Zeichne eine Trennung, die genau ein Gebiet in zwei gültige Teile teilt." : `${name(state, state.mapCreation?.activePlayerId)} zeichnet gerade die nächste Trennung.`, topicIds: ["mapCreation", "pois"] };
    }
    case GamePhase.Setup: return { title: "Vorbereitung", action: "Die Karte ist fertig. Prüft eure persönlichen Fraktionen und startet danach die Startauktionen.", topicIds: ["factions", "startAuctions"] };
    case GamePhase.StartAuctions: return { title: "Startauktionen", action: "Die aktuelle Startauktion ist geöffnet. Gib dein verdecktes Gebot ab oder warte auf die Auflösung.", topicIds: ["startAuctions"] };
    case GamePhase.RoundReady: return { title: "Nächste Runde", action: "Starte die Runde; danach legt der Core die Aktivierungszahlen fest.", topicIds: ["rounds", "activation"] };
    case GamePhase.ActivationPhase: return { title: "Aktivierung", action: state.activePlayerId === viewerPlayerId ? "Wähle eines deiner vom Core freigegebenen Gebiete und nutze sein Symbol." : `${name(state, state.activePlayerId)} aktiviert gerade ein Gebiet.`, topicIds: ["activation", "diamonds", "clubs", "hearts", "spades"] };
    case GamePhase.ActionPhase: return { title: "Aktionsphase", action: state.activePlayerId === viewerPlayerId ? "Wähle eine vom Core angebotene Auktion oder einen Krieg." : `${name(state, state.activePlayerId)} führt gerade eine Grundaktion aus.`, topicIds: ["auctions", "war", "rounds"] };
    case GamePhase.Scoring: return { title: "Wertung", action: "Wähle bei Bedarf einen zulässigen größten Reichsbereich; danach rechnet der Core das Ergebnis aus.", topicIds: ["scoring", "frontTerritory", "factions", "pois"] };
    case GamePhase.Finished: return { title: "Partie beendet", action: "Die Endwertung zeigt alle Punkte und den Sieger.", topicIds: ["scoring", "frontTerritory", "overview"] };
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
  [DomainErrorCode.TerritoryAlreadyInWar]: "Dieses Gebiet war in dieser Runde bereits in einem Krieg beteiligt.",
  [DomainErrorCode.LargeTerritoryWarLimitReached]: "Dieses Großgebiet war in dieser Runde bereits an zwei Kriegen beteiligt.",
  [DomainErrorCode.LargeTerritoryInitiatorLimitReached]: "Ein Großgebiet darf pro Runde höchstens einen Krieg selbst beginnen.",
  [DomainErrorCode.InvalidSpadeActivation]: "Dieser ♠-Effekt steht in diesem Krieg nicht zur Verfügung.",
  [DomainErrorCode.SpadeChoiceAlreadyLocked]: "Deine ♠-Entscheidung ist bereits verdeckt festgelegt.",
  [DomainErrorCode.InvalidSplitResolution]: "Diese Teilung entspricht nicht den aktuellen Vorgaben.",
  [DomainErrorCode.InvalidSetupBoundaryDraft]: "Dieser Grenzentwurf teilt nicht genau ein Gebiet regelkonform.",
  [DomainErrorCode.InvalidPoiPlacement]: "Dieser Strategische Punkt kann auf dieser Zelle oder in dieser Etappe nicht platziert werden.",
};

export function formatDomainError(error: unknown): string {
  if (error instanceof DomainError) return DOMAIN_MESSAGES[error.code] ?? "Diese Aktion ist im aktuellen Zustand nicht verfügbar.";
  return error instanceof Error ? error.message : String(error);
}
