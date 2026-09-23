import type { GameReadModel } from "../game-read-model";

interface StateInspectorProps {
  state: GameReadModel;
}

function inspectableState(state: GameReadModel): object {
  return {
    ...state,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      globalInfluence: player.globalInfluence,
      availableBasicBids: player.availableBasicBids,
      turnStatus: player.turnStatus,
    })),
    auction: state.auction && {
      ...state.auction,
      submittedBids: Object.fromEntries(Object.keys(state.auction.submittedBids).map((id) => [id, "Abgegeben – verdeckt"])),
    },
    pendingSplit: state.pendingSplit && { ...state.pendingSplit, bids: "Verdeckt – Debug-Informationen einschalten" },
  };
}

export function StateInspector({ state }: StateInspectorProps) {
  return (
    <details className="panel state-inspector">
      <summary>Spielansicht anzeigen <span className="muted">verdeckte Werte ausgeblendet</span></summary>
      <pre>{JSON.stringify(inspectableState(state), null, 2)}</pre>
    </details>
  );
}
