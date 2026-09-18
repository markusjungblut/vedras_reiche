import type { GameState } from "@vedras/game-core";

interface StateInspectorProps {
  state: GameState;
  showHidden: boolean;
}

function inspectableState(state: GameState, showHidden: boolean): object {
  if (showHidden) return state;
  return {
    ...state,
    players: state.players.map(({ secretFactionSuit: _secretFactionSuit, ...player }) => player),
    auction: state.auction && {
      ...state.auction,
      submittedBids: Object.fromEntries(Object.keys(state.auction.submittedBids).map((id) => [id, "Abgegeben – verdeckt"])),
    },
    pendingSplit: state.pendingSplit && { ...state.pendingSplit, bids: "Verdeckt – Debug-Informationen einschalten" },
  };
}

export function StateInspector({ state, showHidden }: StateInspectorProps) {
  return (
    <details className="panel state-inspector">
      <summary>GameState anzeigen <span className="muted">{showHidden ? "mit Debug-Informationen" : "verdeckte Werte ausgeblendet"}</span></summary>
      <pre>{JSON.stringify(inspectableState(state, showHidden), null, 2)}</pre>
    </details>
  );
}
