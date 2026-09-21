import { formatRoundedScoreHundredths, formatScoreHundredths, GameActionType, type GameAction, type GameState, type TerritoryScoreBreakdown } from "@vedras/game-core";
import { suitName, suitSymbol } from "../formatters/suit-label";

interface ScoringPanelProps {
  readonly state: GameState;
  readonly playerName: (id: string) => string;
  readonly onAction: (action: GameAction) => void;
}

function BonusLine({ label, value }: { readonly label: string; readonly value: number }) {
  return value === 0 ? null : <div><span>{label}</span><strong>+{value} %</strong></div>;
}

function TerritoryBreakdown({ score }: { readonly score: TerritoryScoreBreakdown }) {
  return <article className="score-territory">
    <div className="score-territory-heading"><strong>{score.territoryId}</strong><strong>{formatScoreHundredths(score.scoreHundredths)}</strong></div>
    <div className="score-lines">
      <div><span>Grundfläche</span><strong>{score.baseArea}</strong></div>
      <BonusLine label="Fraktion" value={score.factionBonusPercent} />
      <BonusLine label="Größtes Reich" value={score.largestRealmBonusPercent} />
      <BonusLine label="Entwicklung" value={score.developmentBonusPercent} />
      <BonusLine label="Wahrzeichen" value={score.landmarkBonusPercent} />
      <BonusLine label="Knotenpunkte" value={score.hubBonusPercent} />
      <BonusLine label="Relikte" value={score.relicBonusPercent} />
      <div><span>Gebietsboni</span><strong>+{score.totalBonusPercent} %</strong></div>
    </div>
  </article>;
}

/** Thin presentation of the core-owned largest-realm choice. */
export function ScoringPanel({ state, playerName, onAction }: ScoringPanelProps) {
  const scoring = state.scoring;
  if (!scoring || scoring.pendingLargestRealmPlayerIds.length === 0) {
    return <section className="control-section"><div className="section-kicker">Endwertung</div><h3>Wertung wird abgeschlossen</h3></section>;
  }
  return <section className="control-section" aria-label="Größtes Reich auswählen">
    <div className="section-kicker">Endwertung</div>
    <h3>Größtes Reich auswählen</h3>
    <p>Gleich große Reiche sind auf der Karte farbig markiert. Die gewählte Komponente erhält für jedes ihrer Gebiete +25 %.</p>
    {scoring.pendingLargestRealmPlayerIds.map((playerId) => {
      const candidateIds = scoring.largestRealmCandidateIdsByPlayerId[playerId] ?? [];
      return <div className="realm-choice" key={playerId}>
        <strong>{playerName(playerId)}</strong>
        <div className="button-row">{candidateIds.map((componentId, index) => {
          const component = scoring.realmComponents.find((candidate) => candidate.id === componentId);
          if (!component) return null;
          return <button type="button" key={componentId} className="secondary-button"
            onClick={() => onAction({ type: GameActionType.ChooseLargestRealm, playerId, componentId })}>
            Reich {String.fromCharCode(65 + index)} · {component.territoryIds.join(", ")} · {component.area} Kästchen
          </button>;
        })}</div>
      </div>;
    })}
  </section>;
}

/** Renders only the immutable result that the core already calculated. */
export function ResultPanel({ state, playerName }: Pick<ScoringPanelProps, "state" | "playerName">) {
  const result = state.result;
  if (!result) return <p className="empty-state">Kein Endergebnis vorhanden.</p>;
  const maxScore = Math.max(...result.playerResults.map((score) => score.totalScoreHundredths));
  const winners = result.playerResults.filter((score) => score.totalScoreHundredths === maxScore);
  const remaining = result.playerResults.filter((score) => score.totalScoreHundredths !== maxScore)
    .sort((left, right) => right.totalScoreHundredths - left.totalScoreHundredths);
  const groups = [winners];
  for (const score of remaining) {
    const lastGroup = groups.at(-1);
    if (lastGroup && lastGroup[0]?.totalScoreHundredths === score.totalScoreHundredths) lastGroup.push(score);
    else groups.push([score]);
  }
  return <section className="control-section result-panel" aria-label="Endergebnis">
    <div className="section-kicker">Endwertung</div>
    <h3>Spiel beendet</h3>
    <p className="winner-message">{winners.length > 1 ? "Gemeinsamer Sieg: " : "Sieger: "}<strong>{winners.map((winner) => playerName(winner.playerId)).join(" · ")}</strong></p>
    <p>Sieger werden anhand der exakten Punktzahl bestimmt. Angezeigt werden ganze Punkte.</p>
    <div className="score-groups">
      {groups.map((group, index) => {
        const placement = groups.slice(0, index).reduce((total, prior) => total + prior.length, 0) + 1;
        return <div className="score-group" key={`${index}-${group[0]!.totalScoreHundredths}`}>
        {group.map((score) => <details key={score.playerId} className="player-score" open={index === 0}>
          <summary><strong>{playerName(score.playerId)}</strong><strong>{formatRoundedScoreHundredths(score.totalScoreHundredths)} Punkte</strong></summary>
          <div className="score-meta">{group.length > 1 ? `Gemeinsamer Platz ${placement}` : `${placement}. Platz`}</div>
          {state.players.find((player) => player.id === score.playerId)?.secretFactionSuit !== undefined && <div className="result-faction">
            {suitSymbol(state.players.find((player) => player.id === score.playerId)!.secretFactionSuit!)} {suitName(state.players.find((player) => player.id === score.playerId)!.secretFactionSuit!)}
          </div>}
          <div className="score-meta">{score.controlledTerritoryCount} Gebiete · {score.controlledArea} Kästchen · {score.activeRelicCount} Relikte</div>
          <div className="territory-score-list">{score.territoryScores.map((territory) => <TerritoryBreakdown key={territory.territoryId} score={territory} />)}</div>
        </details>)}
      </div>;
      })}
    </div>
  </section>;
}
