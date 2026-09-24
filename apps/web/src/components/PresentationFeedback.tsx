import type { PresentationState } from "../presentation/game-presentation";

export function ActivationNumberReveal({ numbers, reveal }: {
  readonly numbers: readonly number[];
  readonly reveal?: PresentationState["activationReveal"];
}) {
  if (reveal === undefined || reveal.numbers.join(",") !== numbers.join(",")) {
    return <span className="activation-numbers">{numbers.join(" · ")}</span>;
  }
  return <span className="activation-roll-reveal" data-testid="activation-number-reveal"
    data-revealed-count={reveal.revealedCount} role="status" aria-label={"Aktivierungszahlen: " + numbers.join(", ")}>
    {numbers.map((number, index) => <span key={index} className={index < reveal.revealedCount ? "is-revealed" : "is-hidden"}>
      {index < reveal.revealedCount ? number : "?"}
    </span>)}
  </span>;
}

function auctionResultLabel(result: NonNullable<PresentationState["auctionResult"]>): string {
  if (result.result === "SPLIT") return "Gleichstand · Teilung folgt";
  if (result.result === "NEUTRAL") return "Kein Besitzerwechsel";
  if (result.result === "WON") return "Gebiet vergeben";
  return "Auktion aufgelöst";
}

export function AuctionResultReveal({ result, playerName }: {
  readonly result?: PresentationState["auctionResult"];
  readonly playerName: (id: string) => string;
}) {
  if (result === undefined) return null;
  return <section className="presentation-card auction-result-reveal" data-testid="auction-result-reveal" aria-live="polite">
    <div className="section-kicker">Auktion aufgedeckt</div>
    <h3>{result.territoryId === undefined ? "Ergebnis" : result.territoryId}</h3>
    {result.bids.length > 0 && <div className="auction-reveal-bids">
      {result.bids.map((bid) => <span key={bid.playerId}>{playerName(bid.playerId)} <strong>{bid.value}</strong></span>)}
    </div>}
    <p><strong>{result.winnerId === undefined ? auctionResultLabel(result) : playerName(result.winnerId) + " gewinnt"}</strong>
      {result.winnerId === undefined ? "" : " · " + auctionResultLabel(result)}</p>
  </section>;
}

const OUTCOME_LABEL = {
  TIE: "Gleichstand",
  BORDER_ADVANCE: "Normaler Grenzgewinn",
  STRONG_ADVANCE: "Starker Vorstoß",
  CONQUEST: "Vollständige Eroberung",
  CUT_AND_CHOOSE: "Durchbruch und Teilung",
} as const;

export function WarDiceReveal({ result }: { readonly result?: PresentationState["warDice"] }) {
  if (result === undefined) return null;
  const attackerVisible = result.stage >= 1;
  const defenderVisible = result.stage >= 2;
  const bonusesVisible = result.stage >= 3;
  const outcomeVisible = result.stage >= 4;
  return <section className="presentation-card war-dice-reveal" data-testid="war-dice-reveal"
    data-stage={result.stage} aria-live="polite"
    aria-label={"Kampf: Angreifer " + result.attackerRoll + ", Verteidiger " + result.defenderRoll + ". " + OUTCOME_LABEL[result.outcome]}>
    <div className="section-kicker">Kampf wird aufgelöst</div>
    <div className="war-reveal-values">
      <span className={attackerVisible ? "is-revealed" : ""}>Angreifer <strong>{attackerVisible ? "W6 " + result.attackerRoll : "?"}</strong></span>
      <span className={defenderVisible ? "is-revealed" : ""}>Verteidiger <strong>{defenderVisible ? "W6 " + result.defenderRoll : "?"}</strong></span>
    </div>
    {bonusesVisible && <p className="war-reveal-bonuses">♠ {result.attackerSpadeBonus} · ♠ {result.defenderSpadeBonus} · Festungen {result.defenderFortressBonus}</p>}
    {outcomeVisible && <p className="war-reveal-outcome"><strong>{result.attackerTotal} : {result.defenderTotal}</strong> · {OUTCOME_LABEL[result.outcome]}</p>}
  </section>;
}

