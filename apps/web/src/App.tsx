import { useRef, useState } from "react";
import {
  applyAction,
  areCellsOrthogonallyConnected,
  DomainError,
  GameActionType,
  GamePhase,
  getAvailableActivationTerritoryIds,
  getPotentialAuctionTerritoryIds,
  getPotentialWarTargets,
  getDiamondTargets,
  getStateAdjacentTerritoryIds,
  getMinimumTerritoryArea,
  getTerritoryCells,
  validateTerritorySplit,
  startRound,
  Suit,
  type ActivationChoice,
  type GameAction,
  type GameState,
  type Territory,
  type GridCell,
} from "@vedras/game-core";
import { ActionPanel } from "./components/ActionPanel";
import { EventLog } from "./components/EventLog";
import { GameHeader } from "./components/GameHeader";
import { PlayerPanel } from "./components/PlayerPanel";
import { StateInspector } from "./components/StateInspector";
import { TerritoryBoard } from "./components/TerritoryBoard";
import { TerritoryDetails } from "./components/TerritoryDetails";
import { createScenario, type ScenarioKind } from "./debug/scenarios";
import type { CardSource, RandomSource } from "@vedras/game-core";
import { suitName } from "./formatters/suit-label";

const DEFAULT_SEED = 12345;
const SCENARIOS: readonly { kind: ScenarioKind; label: string; detail: string }[] = [
  { kind: "START_AUCTIONS", label: "Startauktionen", detail: "Zwei Auslagen und verdeckte Startgebote" },
  { kind: "ACTIVATION_PHASE", label: "Aktivierungsphase", detail: "Symbole und Gebietsreihenfolge ausprobieren" },
  { kind: "ACTION_PHASE", label: "Aktionsphase", detail: "Grundaktionen und Spielerwechsel" },
  { kind: "NORMAL_AUCTION", label: "Normale Auktion", detail: "Alle Spieler geben verdeckt Gebote ab" },
];

interface Runtime {
  readonly randomSource: RandomSource;
  readonly cardSource: CardSource;
}

interface SplitDraft {
  readonly splitId: string;
  readonly partAKeys: readonly string[];
  readonly originalCardPart: "A" | "B";
}

function nextTimestamp(state: GameState): string {
  return new Date(Date.UTC(2026, 0, 1) + state.events.length * 1000).toISOString();
}

function playerName(state: GameState, id: string): string {
  return state.players.find((player) => player.id === id)?.name ?? id;
}

function neighboringTerritories(state: GameState, source: Territory): Territory[] {
  const adjacent = new Set(getStateAdjacentTerritoryIds(state, source.id));
  return state.territories.filter((territory) => adjacent.has(territory.id));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

interface ControlProps {
  readonly state: GameState;
  readonly selectedTerritoryId?: string | undefined;
  readonly onSelectTerritory: (id: string) => void;
  readonly onAction: (action: GameAction) => void;
  readonly onStartRound: () => void;
  readonly splitDraft?: SplitDraft | undefined;
  readonly onToggleSplitCell: (cell: GridCell) => void;
  readonly onSetOriginalCardPart: (part: "A" | "B") => void;
}

function AuctionBidControls({ state, onAction }: Pick<ControlProps, "state" | "onAction">) {
  const auction = state.auction;
  const [startBid, setStartBid] = useState(0);
  const [basicBid, setBasicBid] = useState(1);
  const [globalInfluence, setGlobalInfluence] = useState(0);
  const [localInfluence, setLocalInfluence] = useState(0);
  if (!auction) return null;
  const nextBidderId = auction.eligiblePlayerIds.find((id) => auction.submittedBids[id] === undefined);
  const nextBidder = state.players.find((player) => player.id === nextBidderId);
  const territory = state.territories.find((item) => item.id === auction.territoryId);
  const startAvailable = nextBidderId === undefined ? [] : state.startAuctions?.availableBidsByPlayerId[nextBidderId] ?? [];
  const basicAvailable = (nextBidder?.availableBasicBids ?? []).filter((value): value is 1 | 2 | 3 =>
    value === 1 || value === 2 || value === 3);
  const chosenBasic = basicAvailable.includes(basicBid as 1 | 2 | 3)
    ? basicBid as 1 | 2 | 3 : basicAvailable[0];
  const chosenStartBid = startAvailable.includes(startBid) ? startBid : startAvailable[0];
  const maxGlobal = nextBidder?.globalInfluence ?? 0;
  const maxLocal = nextBidderId === undefined ? 0 : territory?.localInfluenceByPlayerId?.[nextBidderId] ?? 0;
  const selectedGlobal = Math.min(globalInfluence, maxGlobal);
  const selectedLocal = Math.min(localInfluence, maxLocal);

  return <section className="control-section" aria-label="Laufende Auktion">
    <div className="section-kicker">Verdeckte Gebote</div>
    <h3>{auction.kind === "START" ? "Startauktion" : "Normale Auktion"} · {auction.territoryId}</h3>
    <p>Alle erforderlichen Gebote werden gleichzeitig aufgedeckt.</p>
    <div className="bid-status-list">
      {auction.eligiblePlayerIds.map((id) => <span key={id} className="status-chip">
        {playerName(state, id)} {auction.submittedBids[id] === undefined ? "· offen" : "✓ abgegeben"}
        {auction.kind === "START" && state.startAuctions && ` · verfügbar: ${state.startAuctions.availableBidsByPlayerId[id]?.join(", ") ?? "–"}`}
      </span>)}
    </div>
    {nextBidderId !== undefined && <div className="bid-entry" key={`${auction.id}:${nextBidderId}`}>
      <strong>{playerName(state, nextBidderId)} gibt jetzt ein Gebot ab</strong>
      {auction.kind === "START" ? <>
        <Field label="Startgebot">
          <select value={chosenStartBid} onChange={(event) => setStartBid(Number(event.target.value))}>
            {startAvailable.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <button type="button" className="primary-button" disabled={chosenStartBid === undefined}
          onClick={() => {
            if (chosenStartBid === undefined) return;
            onAction({ type: GameActionType.SubmitAuctionBid, playerId: nextBidderId,
              auctionId: auction.id, bid: { kind: "START", value: chosenStartBid } });
            setStartBid(0);
          }}>Gebot verdeckt abgeben</button>
      </> : <>
        <Field label="Grundgebot">
          <select value={chosenBasic ?? ""} onChange={(event) => setBasicBid(Number(event.target.value))}>
            {basicAvailable.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <div className="number-fields">
          <Field label={`Globaler Einfluss (0–${maxGlobal})`}>
            <input type="number" min="0" max={maxGlobal} step="1" value={selectedGlobal}
              onChange={(event) => setGlobalInfluence(Math.max(0, Number(event.target.value)))} />
          </Field>
          <Field label={`Lokaler Einfluss auf ${auction.territoryId} (0–${maxLocal})`}>
            <input type="number" min="0" max={maxLocal} step="1" value={selectedLocal}
              onChange={(event) => setLocalInfluence(Math.max(0, Number(event.target.value)))} />
          </Field>
        </div>
        <p className="bid-total">Gebotswert: {(chosenBasic ?? 0) + selectedGlobal + selectedLocal}</p>
        <button type="button" className="primary-button" disabled={chosenBasic === undefined}
          onClick={() => {
            if (chosenBasic === undefined) return;
            onAction({ type: GameActionType.SubmitAuctionBid, playerId: nextBidderId,
              auctionId: auction.id,
              bid: { kind: "NORMAL", basicBid: chosenBasic,
                globalInfluence: selectedGlobal, localInfluence: selectedLocal } });
            setBasicBid(1);
            setGlobalInfluence(0);
            setLocalInfluence(0);
          }}>Gebot verdeckt abgeben</button>
      </>}
      <small>Nach der Abgabe zeigt die Ansicht nur noch „abgegeben“.</small>
    </div>}
  </section>;
}

function SplitEditor({ state, onAction, splitDraft, onToggleSplitCell, onSetOriginalCardPart }: ControlProps) {
  const split = state.pendingSplit!;
  const map = state.map;
  const original = state.territories.find((territory) => territory.id === split.originalTerritoryId);
  const allCells = map && original ? getTerritoryCells(map, original.id) : [];
  const partAKeys = splitDraft?.partAKeys ?? [];
  const originalCardPart = splitDraft?.originalCardPart ?? "A";
  if (!map || !original) return <p>Für diese Teilung ist keine Rasterkarte verfügbar.</p>;
  const partA = partAKeys.map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y } as GridCell;
  });
  const minimum = getMinimumTerritoryArea(map.format);
  const validation = validateTerritorySplit(map, original.id, partA, minimum);
  const partAConnected = areCellsOrthogonallyConnected(partA);
  const partBConnected = areCellsOrthogonallyConnected(validation.partBCells);
  const divider = split.dividerPlayerId ?? split.openerPlayerId ?? split.auctioneerPlayerId;
  const chooser = split.firstChooserPlayerId;
  if (split.stage === "AWAITING_CHOICE" && split.proposal) {
    return <section className="control-section" aria-label="Gebietsteilung auswählen">
      <div className="section-kicker">Cut and Choose · Auswahl</div>
      <h3>{chooser ? `${playerName(state, chooser)} wählt zuerst` : "Auswahl steht an"}</h3>
      <p>Teil A: {split.proposal.partACells.length} · Teil B: {split.proposal.partBCells.length} Kästchen. Die helle Linie auf der Karte ist die neue Grenze.</p>
      <div className="button-row">
        <button type="button" className="primary-button" onClick={() => onAction({ type: GameActionType.ChooseSplitPart, splitId: split.id, playerId: chooser ?? "", chosenPart: "A" })}>Teil A wählen</button>
        <button type="button" className="secondary-button" onClick={() => onAction({ type: GameActionType.ChooseSplitPart, splitId: split.id, playerId: chooser ?? "", chosenPart: "B" })}>Teil B wählen</button>
      </div>
    </section>;
  }
  return <section className="control-section" aria-label="Gebietsteilung bearbeiten">
    <div className="section-kicker">Cut and Choose · Grenze ziehen</div>
    <h3>{divider ? `${playerName(state, divider)} zieht die Grenze` : "Divider zieht die Grenze"}</h3>
    <p>{chooser ? `${playerName(state, chooser)} wählt anschließend zuerst.` : "Danach wählt der andere Höchstbietende zuerst."} Klicke die Zellen direkt auf der Karte oder hier an.</p>
    <p>Teil A: {partA.length} Kästchen {partA.length >= minimum ? "✓" : `✗ mindestens ${minimum}`} · Zusammenhang {partAConnected ? "✓" : "✗"}</p>
    <p>Teil B: {validation.partBCells.length} Kästchen {validation.partBCells.length >= minimum ? "✓" : `✗ mindestens ${minimum}`} · Zusammenhang {partBConnected ? "✓" : "✗"}</p>
    <p>{validation.valid ? "Beide Teile sind zusammenhängend und regelkonform." : `Noch nicht gültig: ${validation.reason ?? "Mindestgröße oder Zusammenhang fehlt"}.`}</p>
    <div className="split-cell-grid" aria-label="Zellen des ursprünglichen Gebiets">
      {allCells.map((cell) => {
        const key = `${cell.x},${cell.y}`;
        const inA = partAKeys.includes(key);
        return <button key={key} type="button" className={inA ? "split-cell part-a" : "split-cell part-b"} onClick={() => onToggleSplitCell(cell)} aria-label={`Kästchen ${cell.x}, ${cell.y}: Teil ${inA ? "A" : "B"}`}>{inA ? "A" : "B"}</button>;
      })}
    </div>
    <div className="button-row">
      <button type="button" className={originalCardPart === "A" ? "selected-button" : "secondary-button"} onClick={() => onSetOriginalCardPart("A")}>Teil A behält die Karte</button>
      <button type="button" className={originalCardPart === "B" ? "selected-button" : "secondary-button"} onClick={() => onSetOriginalCardPart("B")}>Teil B behält die Karte</button>
    </div>
    <button type="button" className="primary-button" disabled={!validation.valid || divider === undefined}
      onClick={() => divider !== undefined && onAction({ type: GameActionType.ProposeTerritorySplit, splitId: split.id, playerId: divider, partACells: partA, originalCardPart })}>Teilung bestätigen</button>
    {allCells.length < 2 * minimum && <button type="button" className="secondary-button"
      onClick={() => onAction({ type: GameActionType.ResolveTerritorySplit, splitId: split.id, resolution: "SPLIT_NOT_POSSIBLE" })}>
      Teilung wegen zu kleiner Fläche unmöglich
    </button>}
  </section>;
}

function ActivationControls({ state, selectedTerritoryId, onSelectTerritory, onAction }: ControlProps) {
  const availableIds = getAvailableActivationTerritoryIds(state);
  const chosenId = selectedTerritoryId && availableIds.includes(selectedTerritoryId)
    ? selectedTerritoryId : availableIds[0];
  const territory = state.territories.find((item) => item.id === chosenId);
  const [suitChoice, setSuitChoice] = useState<Suit>(Suit.Clubs);
  const [clubTarget, setClubTarget] = useState("");
  const [clubChoice, setClubChoice] = useState<ActivationChoice["type"]>("CLUB_BUILD_SETTLEMENT");
  const [extraSuit, setExtraSuit] = useState<Suit>(Suit.Diamonds);
  if (!territory?.card || !state.activePlayerId) return <p>Keine offene Aktivierung.</p>;
  const sourceSuit = territory.card.additionalSuit === undefined ? territory.card.suit
    : [territory.card.suit, territory.card.additionalSuit].includes(suitChoice) ? suitChoice : territory.card.suit;
  const ownTargets = [territory, ...neighboringTerritories(state, territory).filter((item) => item.ownerId === state.activePlayerId)];
  const chosenClubTarget = ownTargets.some((item) => item.id === clubTarget) ? clubTarget : ownTargets[0]?.id;
  const neighbors = neighboringTerritories(state, territory);
  const neutralNeighbors = neighbors.filter((item) => item.ownerId === null);
  const diamondTargets = sourceSuit === Suit.Diamonds ? getDiamondTargets(state, territory.id) : undefined;
  const activate = (choice: ActivationChoice) => onAction({
    type: GameActionType.ActivateTerritory,
    playerId: state.activePlayerId!,
    territoryId: territory.id,
    selectedSuit: sourceSuit,
    choice,
  });
  const selectedClubChoice = ["CLUB_BUILD_SETTLEMENT", "CLUB_UPGRADE_CITY",
    "CLUB_ADD_ACTIVATION_NUMBER", "CLUB_ADD_SECOND_SUIT"].includes(clubChoice)
    ? clubChoice : "CLUB_BUILD_SETTLEMENT";
  return <section className="control-section" aria-label="Aktivierung">
    <div className="section-kicker">Aktivierungsphase</div>
    <h3>{playerName(state, state.activePlayerId)} aktiviert</h3>
    <p>Aktivierungszahlen: {state.activationNumbers.join(" · ")}</p>
    <div className="button-row">
      {availableIds.map((id) => <button key={id} type="button"
        className={id === chosenId ? "selected-button" : "secondary-button"}
        onClick={() => onSelectTerritory(id)}>{id}</button>)}
    </div>
    {territory.card.additionalSuit !== undefined && <Field label="Symbol dieser Aktivierung">
      <select value={sourceSuit} onChange={(event) => setSuitChoice(event.target.value as Suit)}>
        {[territory.card.suit, territory.card.additionalSuit].map((suit) =>
          <option key={suit} value={suit}>{suitName(suit)}</option>)}
      </select>
    </Field>}
    <h4>Aktion für {territory.id}</h4>
    {sourceSuit === Suit.Diamonds && <>
      <p>Gegnerische Grenze markieren:</p>
      <div className="button-row">{diamondTargets?.opponentTerritoryIds.map((id) =>
        <button key={id} type="button" className="secondary-button"
          onClick={() => activate({ type: "DIAMOND_MARK_BORDER", targetTerritoryId: id })}>{id} markieren</button>)}</div>
      <p>Grenzverschiebung zu neutralem Gebiet vormerken:</p>
      <div className="button-row">{diamondTargets?.neutralTerritoryIds.map((id) =>
        <button key={id} type="button" className="secondary-button"
          onClick={() => activate({ type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: id })}>{id} vormerken</button>)}</div>
    </>}
    {sourceSuit === Suit.Clubs && <>
      <Field label="Entwicklungsziel">
        <select value={chosenClubTarget ?? ""} onChange={(event) => setClubTarget(event.target.value)}>
          {ownTargets.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
      </Field>
      <Field label="Entwicklung">
        <select value={selectedClubChoice} onChange={(event) => setClubChoice(event.target.value as ActivationChoice["type"])}>
          <option value="CLUB_BUILD_SETTLEMENT">Siedlung bauen</option>
          <option value="CLUB_UPGRADE_CITY">Zur Stadt aufwerten</option>
          <option value="CLUB_ADD_ACTIVATION_NUMBER">Zweite Aktivierungszahl</option>
          <option value="CLUB_ADD_SECOND_SUIT">Zweites Symbol</option>
        </select>
      </Field>
      {selectedClubChoice === "CLUB_ADD_SECOND_SUIT" && <Field label="Zusätzliches Symbol">
        <select value={extraSuit} onChange={(event) => setExtraSuit(event.target.value as Suit)}>
          {Object.values(Suit).map((suit) => <option key={suit} value={suit}>{suitName(suit)}</option>)}
        </select>
      </Field>}
      <button type="button" className="primary-button" disabled={chosenClubTarget === undefined}
        onClick={() => {
          if (chosenClubTarget === undefined) return;
          const choice: ActivationChoice = selectedClubChoice === "CLUB_UPGRADE_CITY"
            ? { type: "CLUB_UPGRADE_CITY", targetTerritoryId: chosenClubTarget }
            : selectedClubChoice === "CLUB_ADD_ACTIVATION_NUMBER"
              ? { type: "CLUB_ADD_ACTIVATION_NUMBER", targetTerritoryId: chosenClubTarget }
              : selectedClubChoice === "CLUB_ADD_SECOND_SUIT"
                ? { type: "CLUB_ADD_SECOND_SUIT", targetTerritoryId: chosenClubTarget, suit: extraSuit }
                : {
                  type: "CLUB_BUILD_SETTLEMENT",
                  targetTerritoryId: chosenClubTarget,
                  ...(state.map && getTerritoryCells(state.map, chosenClubTarget)[0] === undefined
                    ? {} : state.map ? { position: getTerritoryCells(state.map, chosenClubTarget)[0] } : {}),
                };
          activate(choice);
        }}>Aktivieren</button>
      <small>Eine neu erhaltene zweite Zahl wirkt erst ab der nächsten Runde.</small>
    </>}
    {sourceSuit === Suit.Hearts && <>
      <button type="button" className="primary-button"
        onClick={() => activate({ type: "HEART_GLOBAL_INFLUENCE" })}>+1 globaler Einfluss</button>
      <p>Oder +2 lokaler Einfluss auf einem neutralen Nachbarn:</p>
      <div className="button-row">{neutralNeighbors.map((item) =>
        <button key={item.id} type="button" className="secondary-button"
          onClick={() => activate({ type: "HEART_LOCAL_INFLUENCE", targetTerritoryId: item.id })}>{item.id}</button>)}</div>
    </>}
    {sourceSuit === Suit.Spades && <button type="button" className="primary-button"
      onClick={() => activate({ type: "SPADE_STORE" })}>♠ für diese Runde speichern</button>}
  </section>;
}

function ActionControls({ state, selectedTerritoryId, onAction }: ControlProps) {
  const activePlayerId = state.activePlayerId;
  const targetIds = activePlayerId === undefined ? [] : getPotentialAuctionTerritoryIds(state, activePlayerId);
  const targets = targetIds.map((id) => state.territories.find((territory) => territory.id === id)).filter((territory): territory is Territory => territory !== undefined);
  const wars = activePlayerId === undefined ? [] : getPotentialWarTargets(state, activePlayerId);
  const selectedTargetId = targets.some((item) => item.id === selectedTerritoryId)
    ? selectedTerritoryId : targets[0]?.id;
  return <section className="control-section" aria-label="Grundaktion">
    <div className="section-kicker">Aktionsphase</div>
    <h3>{activePlayerId ? `${playerName(state, activePlayerId)} ist am Zug` : "Keine aktive Grundaktion"}</h3>
    {activePlayerId && <>
      {state.actionPhase?.secondAuctionAvailable && <p>Nach dem Gleichstand kannst du eine zweite Auktion eröffnen oder den Zug beenden.</p>}
      {targets.length > 0 ? <>
        <p>Neutraler Nachbar für die Auktion:</p>
        <div className="button-row">{targets.map((item) => <button key={item.id} type="button"
          className={item.id === selectedTargetId ? "selected-button" : "secondary-button"}
          onClick={() => onAction({ type: GameActionType.OpenAuction,
            playerId: activePlayerId, territoryId: item.id })}>Auktion um {item.id} eröffnen</button>)}</div>
      </> : <p>Kein angrenzendes neutrales Gebiet verfügbar.</p>}
      {wars.length > 0 ? <>
        <p>Alternativ einen Krieg für die spätere AP5-Auswertung vormerken:</p>
        <div className="button-row">{wars.map(({ attackerTerritoryId, defenderTerritoryId }) => <button key={`${attackerTerritoryId}:${defenderTerritoryId}`} type="button"
          className="secondary-button" onClick={() => onAction({ type: GameActionType.StartWar,
            playerId: activePlayerId, attackerTerritoryId, defenderTerritoryId })}>
          Mit {attackerTerritoryId} gegen {defenderTerritoryId} beginnen
        </button>)}</div>
      </> : <p className="muted">Kein angrenzendes gegnerisches Gebiet verfügbar.</p>}
      {state.actionPhase?.secondAuctionAvailable && <button type="button" className="secondary-button"
        onClick={() => onAction({ type: GameActionType.EndActionTurn, playerId: activePlayerId })}>Zug beenden</button>}
      {!state.actionPhase?.secondAuctionAvailable && wars.length === 0 && <p className="muted">Kriegsauswertung folgt in AP5.</p>}
    </>}
  </section>;
}

function PhaseControls(props: ControlProps) {
  const { state, onAction, onStartRound } = props;
  if (state.pendingSplit) return <SplitEditor {...props} />;
  if (state.auction) return <AuctionBidControls state={state} onAction={onAction} />;
  if (state.pendingWar) return <section className="control-section">
    <div className="section-kicker">Krieg ausstehend</div>
    <h3>{state.pendingWar.attackerTerritoryId} gegen {state.pendingWar.defenderTerritoryId}</h3>
    <p>Der Kampf wird erst in AP5 aufgelöst.</p>
  </section>;
  switch (state.phase) {
    case GamePhase.Setup:
      return <p>Die Demo-Karte ist bereit.</p>;
    case GamePhase.StartAuctions:
      return <section className="control-section">
        <div className="section-kicker">Startauktionen · Runde {state.startAuctions?.round}</div>
        <h3>Auslage</h3>
        <p>{state.startAuctions?.displayTerritoryIds.join(" · ")}</p>
        <p>Auktionssteller: {state.startAuctions && playerName(state, state.startAuctions.auctioneerPlayerId)}</p>
        <p>Bereits mit Gebiet: {state.startAuctions?.awardedPlayerIds.map((id) => playerName(state, id)).join(", ") || "niemand"}</p>
        <button type="button" className="primary-button" onClick={() => onAction({ type: GameActionType.OpenNextStartAuction })}>Nächste Startauktion eröffnen</button>
      </section>;
    case GamePhase.RoundReady:
      return <section className="control-section"><div className="section-kicker">Runde bereit</div>
        <h3>{state.round === 0 ? "Erste Runde" : "Nächste Runde"}</h3>
        <button type="button" className="primary-button" onClick={onStartRound}>Runde beginnen</button>
      </section>;
    case GamePhase.ActivationPhase:
      return <ActivationControls {...props} />;
    case GamePhase.ActionPhase:
      return <ActionControls {...props} />;
    case GamePhase.Scoring:
      return <p>Alle Runden sind abgeschlossen. Die Wertung folgt in einem späteren Arbeitspaket.</p>;
    case GamePhase.Finished:
      return <p>Spiel beendet.</p>;
  }
}

export default function App() {
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [scenario, setScenario] = useState<ScenarioKind | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | undefined>();
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const runtime = useRef<Runtime | null>(null);

  const loadScenario = (kind: ScenarioKind, chosenSeed: number) => {
    try {
      const demo = createScenario(kind, chosenSeed);
      runtime.current = { randomSource: demo.randomSource, cardSource: demo.cardSource };
      setState(demo.state);
      setSplitDraft(null);
      setSelectedTerritoryId(undefined);
      setScenario(kind);
      setSeed(chosenSeed);
      setError(null);
    } catch (caught) {
      setError(caught instanceof DomainError ? caught.code : String(caught));
    }
  };
  const selectedSeed = () => {
    const value = Number(seedInput);
    if (!Number.isSafeInteger(value) || value < 0) {
      setError("Bitte einen nicht negativen ganzzahligen Seed eingeben.");
      return undefined;
    }
    return value;
  };
  const startSelectedScenario = (kind: ScenarioKind) => {
    const value = selectedSeed();
    if (value !== undefined) loadScenario(kind, value);
  };
  const dispatch = (action: GameAction) => {
    if (!state || !runtime.current) return;
    try {
      const result = applyAction(state, action, {
        randomSource: runtime.current.randomSource,
        cardSource: runtime.current.cardSource,
        timestamp: nextTimestamp(state),
      });
      setState(result.state);
      setError(null);
    } catch (caught) {
      setError(caught instanceof DomainError ? caught.code : String(caught));
    }
  };
  const beginRound = () => {
    if (!state || !runtime.current) return;
    try {
      const result = startRound(state, runtime.current.randomSource, nextTimestamp(state));
      setState(result.state);
      setError(null);
    } catch (caught) {
      setError(caught instanceof DomainError ? caught.code : String(caught));
    }
  };
  const reset = () => {
    if (scenario && window.confirm("Aktuelles Demo-Spiel wirklich zurücksetzen?")) loadScenario(scenario, seed);
  };
  const name = (id: string) => state ? playerName(state, id) : id;
  const highlightedIds = state?.phase === GamePhase.ActivationPhase
    ? getAvailableActivationTerritoryIds(state) : [];
  const split = state?.pendingSplit;
  const initialSplitCells = split && state?.map
    ? getTerritoryCells(state.map, split.originalTerritoryId) : [];
  const currentSplitDraft: SplitDraft | undefined = split ? splitDraft?.splitId === split.id
    ? splitDraft : {
      splitId: split.id,
      partAKeys: initialSplitCells.slice(0, Math.floor(initialSplitCells.length / 2)).map((cell) => `${cell.x},${cell.y}`),
      originalCardPart: "A",
    } : undefined;
  const toggleSplitCell = (cell: GridCell) => {
    if (!currentSplitDraft || split?.stage === "AWAITING_CHOICE") return;
    const key = `${cell.x},${cell.y}`;
    if (!initialSplitCells.some((item) => item.x === cell.x && item.y === cell.y)) return;
    const partAKeys = currentSplitDraft.partAKeys.includes(key)
      ? currentSplitDraft.partAKeys.filter((item) => item !== key)
      : [...currentSplitDraft.partAKeys, key];
    setSplitDraft({ ...currentSplitDraft, partAKeys });
  };
  const setOriginalCardPart = (part: "A" | "B") => {
    if (currentSplitDraft) setSplitDraft({ ...currentSplitDraft, originalCardPart: part });
  };

  return <div className="app-shell">
    {!state ? <main className="welcome-screen">
      <span className="eyebrow">Visual Debug Client</span>
      <h1>Vedras Reiche</h1>
      <p>Ein lokales Testspiel mit drei Spielern und 16 Rastergebieten.</p>
      <Field label="Debug-Seed">
        <input type="number" min="0" step="1" value={seedInput}
          onChange={(event) => setSeedInput(event.target.value)} />
      </Field>
      <button type="button" className="primary-button"
        onClick={() => startSelectedScenario("START_AUCTIONS")}>Neues Demo-Spiel</button>
      <div className="scenario-grid">
        {SCENARIOS.map((item) => <button type="button" key={item.kind} className="scenario-tile"
          onClick={() => startSelectedScenario(item.kind)}>
          <strong>{item.label}</strong><span>{item.detail}</span>
        </button>)}
      </div>
      {error && <p role="alert" className="error-banner">Aktion nicht möglich: {error}</p>}
    </main> : <>
      <GameHeader state={state} playerName={name} />
      <main className="dashboard">
        <section className="toolbar panel">
          <div><span className="section-kicker">Debug-Szenarien</span><strong>Seed {seed}</strong></div>
          <div className="button-row">
            {SCENARIOS.map((item) => <button key={item.kind} type="button"
              className={scenario === item.kind ? "selected-button" : "secondary-button"}
              onClick={() => startSelectedScenario(item.kind)}>{item.label}</button>)}
          </div>
          <Field label="Seed ändern">
            <input type="number" min="0" step="1" value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)} />
          </Field>
          <button type="button" className="secondary-button" onClick={reset}>Demo zurücksetzen</button>
        </section>
        {error && <div role="alert" className="error-banner">Aktion nicht möglich: <strong>{error}</strong></div>}
        <div className="main-grid">
          <div className="board-column panel">
            <div className="panel-heading"><span className="section-kicker">Spielbrett</span><h2>Gebietsübersicht</h2></div>
            <TerritoryBoard state={state} selectedId={selectedTerritoryId}
              onSelect={setSelectedTerritoryId} highlightedIds={highlightedIds} playerName={name}
              splitDraft={currentSplitDraft} onToggleSplitCell={toggleSplitCell} />
          </div>
          <div className="sidebar-column">
            <div className="panel"><PlayerPanel state={state} playerName={name} /></div>
            <div className="panel"><TerritoryDetails state={state} territoryId={selectedTerritoryId} playerName={name} /></div>
          </div>
        </div>
        <div className="lower-grid">
          <ActionPanel><PhaseControls state={state} selectedTerritoryId={selectedTerritoryId}
            onSelectTerritory={setSelectedTerritoryId} onAction={dispatch} onStartRound={beginRound}
            splitDraft={currentSplitDraft} onToggleSplitCell={toggleSplitCell}
            onSetOriginalCardPart={setOriginalCardPart} /></ActionPanel>
          <div className="panel"><EventLog events={state.events} playerName={name} /></div>
        </div>
        <div className="inspector-row panel">
          <label className="debug-toggle"><input type="checkbox" checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)} /> Verdeckte Informationen anzeigen</label>
          <StateInspector state={state} showHidden={showHidden} />
          <button type="button" className="text-button" onClick={() => dispatch({
            type: GameActionType.OpenAuction, playerId: "__ungueltig__", territoryId: state.territories[0]?.id ?? "",
          })}>Ungültige Aktion testen</button>
        </div>
      </main>
    </>}
  </div>;
}
