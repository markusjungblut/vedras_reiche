import { GamePhase, MapCreationStage } from "@vedras/game-core";
import type { RuleHelpId } from "../help/rule-help";
import type { TutorialProgress, TutorialStep } from "../help/tutorial-state";
import type { GameReadModel } from "../game-read-model";

interface Hint { readonly step: TutorialStep; readonly title: string; readonly text: string; readonly topic: RuleHelpId; }

function relevantHint(state: GameReadModel, viewerPlayerId: string | undefined, progress: TutorialProgress): Hint | undefined {
  const ownTurn = state.activePlayerId === viewerPlayerId;
  const mapStage = state.mapCreation?.stage;
  if (state.phase === GamePhase.MapCreation && ownTurn && mapStage === MapCreationStage.DrawTerritories && !progress.seen.mapCreation) return {
    step: "mapCreation", title: "Dein erster Kartenbauzug", text: "Ziehe mit dem Grenzstift eine Linie, die genau ein bestehendes Gebiet in zwei gültige Gebiete teilt.", topic: "mapCreation",
  };
  if (state.phase === GamePhase.MapCreation && ownTurn && mapStage !== MapCreationStage.DrawTerritories && mapStage !== MapCreationStage.ReadyToFinalize && !progress.seen.pois) return {
    step: "pois", title: "Strategischen Punkt platzieren", text: "Wähle eine freie Rasterzelle. Der Strategische Punkt bleibt auf dieser Zelle, auch wenn sich Grenzen später ändern.", topic: "pois",
  };
  if (state.phase === GamePhase.Setup && !progress.seen.factions) return {
    step: "factions", title: "Deine geheime Fraktion", text: "Sie gibt am Ende +25 % für deine Gebietskarten mit ihrem ursprünglichen Symbol. Zeige sie nur dir selbst an.", topic: "factions",
  };
  if (state.phase === GamePhase.ActivationPhase && ownTurn && !progress.seen.activation) return {
    step: "activation", title: "Aktiviere passende Karten", text: "Die freigegebenen Gebiete tragen mindestens eine aktuelle Aktivierungszahl. Wähle dann ihre Symbolfähigkeit.", topic: "activation",
  };
  if (state.auction && !progress.seen.auction) return {
    step: "auction", title: state.auction.kind === "START" ? "Startauktion" : "Verdeckte Auktion", text: "Alle berechtigten Spieler geben ihr Gebot verdeckt ab. Erst danach wird das Ergebnis aufgelöst.", topic: state.auction.kind === "START" ? "startAuctions" : "auctions",
  };
  if (state.pendingWar && !progress.seen.war) return {
    step: "war", title: "Krieg in Schritten", text: "Die Kriegsansicht führt durch ♠-Entscheidung, Kampf und das passende Ergebnis. Nur die beteiligten Spieler können handeln.", topic: "war",
  };
  if (state.pendingSplit && !progress.seen.cutAndChoose) return {
    step: "cutAndChoose", title: "Cut-and-Choose", text: "Eine Person zieht die gültige Teilung, die andere wählt zuerst einen Teil. Die Karte markiert A und B.", topic: "cutAndChoose",
  };
  if (state.phase === GamePhase.Scoring && !progress.seen.scoring) return {
    step: "scoring", title: "Endwertung", text: "Prüfe die Punkte je Gebiet. Bei einem Gleichstand für das größte Reich wird ein zulässiger Bereich gewählt.", topic: "scoring",
  };
  return undefined;
}

export function FirstGameHint({ state, viewerPlayerId, progress, onDismiss, onOpenHelp }: {
  readonly state: GameReadModel; readonly viewerPlayerId?: string | undefined; readonly progress: TutorialProgress;
  readonly onDismiss: (step: TutorialStep) => void; readonly onOpenHelp: (topic: RuleHelpId) => void;
}) {
  const hint = relevantHint(state, viewerPlayerId, progress);
  if (!hint) return null;
  return <section className="first-game-hint" aria-label="Hinweis für die erste Partie"><p className="section-kicker">Erste Partie</p><h3>{hint.title}</h3><p>{hint.text}</p>
    <div className="button-row"><button type="button" className="secondary-button" onClick={() => onOpenHelp(hint.topic)}>Warum?</button><button type="button" className="text-button" onClick={() => onDismiss(hint.step)}>Hinweis ausblenden</button></div>
  </section>;
}
