import { formatRoundedScoreHundredths } from "@vedras/game-core";
import type { AccountStatisticsDto, MatchDetailDto, MatchHistoryListItemDto } from "@vedras/protocol";

function decimal(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
}

function MatchFacts({ highlights }: { readonly highlights: readonly string[] }) {
  if (highlights.length === 0) return null;
  return <section className="match-facts" aria-label="Deine Matchfakten">
    <div className="section-kicker">Deine Partie</div>
    <ul>{highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
  </section>;
}

export function FinishedMatchFacts({ detail }: { readonly detail: MatchDetailDto | undefined }) {
  return detail === undefined ? null : <MatchFacts highlights={detail.highlights} />;
}

interface AccountStatisticsPanelProps {
  readonly statistics?: AccountStatisticsDto | undefined;
  readonly matches: readonly MatchHistoryListItemDto[];
  readonly detail?: MatchDetailDto | undefined;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly onOpenMatch: (matchId: string) => void;
  readonly onCloseDetail: () => void;
}

/** Presentation only: every count and ranking comes from the private server API. */
export function AccountStatisticsPanel({ statistics, matches, detail, loading, error, onOpenMatch, onCloseDetail }: AccountStatisticsPanelProps) {
  if (loading) return <section className="account-history" aria-label="Statistiken"><p className="muted">Statistiken werden geladen …</p></section>;
  if (error !== undefined) return <section className="account-history" aria-label="Statistiken"><p className="empty-state">{error}</p></section>;
  if (statistics === undefined) return null;
  if (detail !== undefined) return <section className="account-history" aria-label="Partiedetails">
    <div className="panel-heading"><div><span className="section-kicker">Partiedetails</span><h3>{new Date(detail.finishedAt).toLocaleDateString("de-DE")}</h3></div><button type="button" className="text-button" onClick={onCloseDetail}>Zur Historie</button></div>
    <p className="muted">{detail.playerCount} Spieler · {detail.rounds} Runden</p>
    <div className="match-placement-list">{detail.placements.map((player) => <div key={`${player.displayName}-${player.placement}`}><span>{player.placement}. {player.displayName}</span><strong>{formatRoundedScoreHundredths(player.finalScoreHundredths)} Punkte</strong><small>{player.finalTerritoriesControlled} Gebiete · {player.finalControlledAreaCells} Zellen</small></div>)}</div>
    <MatchFacts highlights={detail.highlights} />
  </section>;
  return <section className="account-history" aria-label="Statistiken">
    <div className="panel-heading"><div><span className="section-kicker">Konto</span><h3>Statistiken</h3></div></div>
    <div className="statistics-grid">
      <div><span>Partien</span><strong>{statistics.matchesPlayed}</strong></div><div><span>Siege</span><strong>{statistics.wins}</strong></div>
      <div><span>Siegquote</span><strong>{decimal(statistics.winRate * 100)} %</strong></div><div><span>Ø Platzierung</span><strong>{statistics.matchesPlayed === 0 ? "—" : decimal(statistics.averagePlacement)}</strong></div>
      <div><span>Ø Score</span><strong>{statistics.matchesPlayed === 0 ? "—" : formatRoundedScoreHundredths(statistics.averageFinalScoreHundredths)}</strong></div><div><span>Rekord</span><strong>{statistics.matchesPlayed === 0 ? "—" : formatRoundedScoreHundredths(statistics.highestFinalScoreHundredths)}</strong></div>
    </div>
    <div className="statistics-records"><strong>Rekorde</strong><dl>
      <div><dt>Größtes Reich</dt><dd>{statistics.records.maxControlledAreaCells} Zellen</dd></div><div><dt>Meiste Gebiete</dt><dd>{statistics.records.maxTerritoriesControlled}</dd></div>
      <div><dt>Kriegssiege</dt><dd>{statistics.records.mostWarsWonInMatch}</dd></div><div><dt>Größter Grenzgewinn</dt><dd>{statistics.records.largestBorderGainCells} Zellen</dd></div>
      <div><dt>Auktionssiege</dt><dd>{statistics.records.mostAuctionsWonInMatch}</dd></div>
    </dl></div>
    <div className="statistics-style"><strong>Aktivierungen</strong><span>♦ {statistics.activationsBySuit.DIAMONDS ?? 0} · ♣ {statistics.activationsBySuit.CLUBS ?? 0} · ♥ {statistics.activationsBySuit.HEARTS ?? 0} · ♠ {statistics.activationsBySuit.SPADES ?? 0}</span></div>
    <div className="match-history-heading"><strong>Letzte Partien</strong><small>Nur deine abgeschlossenen Mehrspielerpartien.</small></div>
    {matches.length === 0 ? <p className="empty-state saved-room-empty">Noch keine abgeschlossenen Partien.</p> : <div className="match-history-list">{matches.map((match) => <button type="button" className="match-history-item" key={match.matchId} onClick={() => onOpenMatch(match.matchId)}>
      <span>{new Date(match.finishedAt).toLocaleDateString("de-DE")} · {match.playerCount} Spieler · Platz {match.placement}</span><strong>{formatRoundedScoreHundredths(match.finalScoreHundredths)} Punkte</strong>
    </button>)}</div>}
  </section>;
}
