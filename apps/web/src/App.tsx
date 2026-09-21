import { useEffect, useRef, useState } from "react";
import {
  applyAction,
  createGameState,
  DomainError,
  GameActionType,
  GamePhase,
  DIGITAL_BOARD_HEIGHT,
  DIGITAL_BOARD_WIDTH,
  DIGITAL_MAP_CONFIG,
  DIGITAL_MIN_TERRITORY_AREA,
  getSetupMapValidationIssues,
  getSetupPoiRequirements,
  MapCreationStage,
  PointOfInterestType,
  getAvailableActivationTerritoryIds,
  getPotentialAuctionTerritoryIds,
  getPotentialWarTargets,
  getDiamondTargets,
  getStateAdjacentTerritoryIds,
  getMinimumTerritoryArea,
  getTerritoryCells,
  fromCellKey,
  areCellsOrthogonallyConnected,
  analyzeSetupPartitionChange,
  deriveSetupRegions,
  normalizeSetupBorderEdges,
  toSetupBorderEdgeKey,
  type SetupBorderEdge,
  validateTerritorySplit,
  Suit,
  type ActivationChoice,
  type GameAction,
  type GameState,
  type PlayerGameView,
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
import { ResultPanel, ScoringPanel } from "./components/ScoringPanel";
import { getMapEditor, NeutralDiamondControls, RecentWarResult, WarControls, type MapEditor } from "./components/WarControls";
import { createScenario, type ScenarioKind } from "./debug/scenarios";
import type { CardSource, RandomSource } from "@vedras/game-core";
import { suitName, suitSymbol } from "./formatters/suit-label";
import { DemoCardSource } from "./debug/demo-card-source";
import { SeededRandomSource } from "./debug/seeded-random-source";
import { LocalGameController, type GameController } from "./controllers/game-controller";
import { RemoteGameController, type MultiplayerCredentials } from "./controllers/remote-game-controller";
import type { PublicRoomState } from "@vedras/protocol";

const DEFAULT_SEED = 12345;
const SERVER_BASE_URL = import.meta.env.VITE_SERVER_URL ?? window.location.origin;
const MULTIPLAYER_SESSION_KEY = "vedras-reiche-multiplayer-session";
const SCENARIOS: readonly { kind: ScenarioKind; label: string; detail: string }[] = [
  { kind: "START_AUCTIONS", label: "Startauktionen", detail: "Zwei Auslagen und verdeckte Startgebote" },
  { kind: "ACTIVATION_PHASE", label: "Aktivierungsphase", detail: "Symbole und Gebietsreihenfolge ausprobieren" },
  { kind: "ACTION_PHASE", label: "Aktionsphase", detail: "Grundaktionen und Spielerwechsel" },
  { kind: "NORMAL_AUCTION", label: "Normale Auktion", detail: "Alle Spieler geben verdeckt Gebote ab" },
  { kind: "WAR_NORMAL", label: "Krieg · Grenzgewinn", detail: "Kampf und Grenzverschiebung" },
  { kind: "WAR_STRONG", label: "Krieg · Vorstoß", detail: "Starker Vorstoß" },
  { kind: "WAR_TIE", label: "Krieg · Gleichstand", detail: "Keine Gebietsänderung" },
  { kind: "WAR_WEAK", label: "Krieg · geschwächt", detail: "Volleroberung nach Niederlage" },
  { kind: "WAR_CONQUEST", label: "Krieg · Eroberung", detail: "Gebiet wechselt den Besitzer" },
  { kind: "WAR_CUT", label: "Krieg · Teilung", detail: "Durchbruch und Cut and Choose" },
  { kind: "WAR_DIAMOND", label: "Krieg · ♦", detail: "Markierte Grenze" },
  { kind: "WAR_DIAMOND_CUT", label: "Krieg · ♦ Teilung", detail: "Teilung mit 1-Zellen-Korrektur" },
  { kind: "WAR_SPADE_FORTRESS", label: "Krieg · ♠ + Festung", detail: "Beide Boni sehen" },
  { kind: "DIAMOND_NEUTRAL", label: "♦ gegen neutral", detail: "Grenze zum neutralen Gebiet" },
  { kind: "SCORING", label: "Endwertung", detail: "Größtes Reich wählen und Ergebnis prüfen" },
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

type SetupMode = "PEN" | "BRUSH" | "CORRECTION";

interface SetupDraft {
  readonly mode: SetupMode;
  /** Cell paths are UI input only; the core receives derived grid edges. */
  readonly strokes: readonly (readonly string[])[];
}

interface NewGamePlayerInput { readonly key: string; readonly name: string; }

interface MultiplayerSession extends MultiplayerCredentials {}

function multiplayerSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

function storedMultiplayerSession(): MultiplayerSession | undefined {
  try {
    const stored = sessionStorage.getItem(MULTIPLAYER_SESSION_KEY);
    if (stored === null) return undefined;
    const parsed = JSON.parse(stored) as Partial<MultiplayerSession>;
    return typeof parsed.roomId === "string" && typeof parsed.playerId === "string" && typeof parsed.sessionToken === "string"
      ? { roomId: parsed.roomId, playerId: parsed.playerId, sessionToken: parsed.sessionToken } : undefined;
  } catch {
    return undefined;
  }
}

function rememberMultiplayerSession(session: MultiplayerSession | undefined): void {
  try {
    if (session === undefined) sessionStorage.removeItem(MULTIPLAYER_SESSION_KEY);
    else sessionStorage.setItem(MULTIPLAYER_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Browser storage is optional for local development.
  }
}

async function postMultiplayer<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, SERVER_BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Die Serveranfrage wurde abgelehnt.");
  return payload;
}

const DEFAULT_PLAYERS: readonly NewGamePlayerInput[] = [
  { key: "seat-1", name: "Anna" }, { key: "seat-2", name: "Ben" }, { key: "seat-3", name: "Clara" },
];

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
  readonly editor?: MapEditor | undefined;
  readonly playerName: (id: string) => string;
  readonly setupDraft?: SetupDraft | undefined;
  readonly onSetSetupDraft?: (draft: SetupDraft) => void;
  readonly setupValidationIssues?: ReturnType<typeof getSetupMapValidationIssues>;
  readonly privacyPlayerId?: string | undefined;
  readonly factionVisible?: boolean;
  readonly onSetPrivacyPlayerId?: (id: string) => void;
  readonly onSetFactionVisible?: (visible: boolean) => void;
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

function ActionControls({ state, selectedTerritoryId, onSelectTerritory, onAction }: ControlProps) {
  const activePlayerId = state.activePlayerId;
  const targetIds = activePlayerId === undefined ? [] : getPotentialAuctionTerritoryIds(state, activePlayerId);
  const targets = targetIds.map((id) => state.territories.find((territory) => territory.id === id)).filter((territory): territory is Territory => territory !== undefined);
  const wars = activePlayerId === undefined ? [] : getPotentialWarTargets(state, activePlayerId);
  const attackerIds = [...new Set(wars.map((war) => war.attackerTerritoryId))];
  const selectedAttacker = selectedTerritoryId && attackerIds.includes(selectedTerritoryId)
    ? selectedTerritoryId : attackerIds[0];
  const defenderIds = wars.filter((war) => war.attackerTerritoryId === selectedAttacker).map((war) => war.defenderTerritoryId);
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
        <p>Oder einen Krieg beginnen:</p>
        <p>1. Eigenes Angriffsgebiet wählen:</p>
        <div className="button-row">{attackerIds.map((id) => <button key={id} type="button"
          className={id === selectedAttacker ? "selected-button" : "secondary-button"}
          onClick={() => onSelectTerritory(id)}>{id}</button>)}</div>
        <p>2. Angrenzendes gegnerisches Gebiet wählen und Krieg bestätigen:</p>
        <div className="button-row">{defenderIds.map((id) => <button key={id} type="button"
          className="secondary-button" onClick={() => selectedAttacker && onAction({ type: GameActionType.StartWar,
            playerId: activePlayerId, attackerTerritoryId: selectedAttacker, defenderTerritoryId: id })}>
          Krieg gegen {id} beginnen
        </button>)}</div>
      </> : <p className="muted">Kein angrenzendes gegnerisches Gebiet verfügbar.</p>}
      {state.actionPhase?.secondAuctionAvailable && <button type="button" className="secondary-button"
        onClick={() => onAction({ type: GameActionType.EndActionTurn, playerId: activePlayerId })}>Zug beenden</button>}
    </>}
  </section>;
}

function setupEdges(strokes: readonly (readonly string[])[], mapWidth: number, mapHeight: number): SetupBorderEdge[] {
  const edges: SetupBorderEdge[] = [];
  for (const stroke of strokes) {
    const cells = stroke.map(fromCellKey);
    if (cells.length < 2) continue;

    const first = cells[0]!;
    if (cells.every((cell) => cell.x === first.x)) {
      const boundaryX = first.x === 0 ? 0 : first.x - 1;
      const drawnMinY = Math.min(...cells.map((cell) => cell.y));
      const minY = drawnMinY <= 1 ? 0 : drawnMinY;
      const drawnMaxY = Math.max(...cells.map((cell) => cell.y));
      const maxY = drawnMaxY >= mapHeight - 2 ? mapHeight - 1 : drawnMaxY;
      for (let y = minY; y <= maxY; y += 1) {
        edges.push({ from: { x: boundaryX, y }, to: { x: boundaryX + 1, y } });
      }
      continue;
    }

    if (cells.every((cell) => cell.y === first.y)) {
      const boundaryY = first.y === 0 ? 0 : first.y - 1;
      const drawnMinX = Math.min(...cells.map((cell) => cell.x));
      const minX = drawnMinX <= 1 ? 0 : drawnMinX;
      const drawnMaxX = Math.max(...cells.map((cell) => cell.x));
      const maxX = drawnMaxX >= mapWidth - 2 ? mapWidth - 1 : drawnMaxX;
      for (let x = minX; x <= maxX; x += 1) {
        edges.push({ from: { x, y: boundaryY }, to: { x, y: boundaryY + 1 } });
      }
      continue;
    }

    for (let index = 1; index < cells.length; index += 1) {
      let current = cells[index - 1]!;
      const target = cells[index]!;
      while (current.x !== target.x) {
        const next = { x: current.x + Math.sign(target.x - current.x), y: current.y };
        edges.push({ from: current, to: next }); current = next;
      }
      while (current.y !== target.y) {
        const next = { x: current.x, y: current.y + Math.sign(target.y - current.y) };
        edges.push({ from: current, to: next }); current = next;
      }
    }
  }
  return edges;
}

function SetupControls(props: ControlProps) {
  const { state, onAction, playerName: name, setupDraft, onSetSetupDraft, setupValidationIssues = [] } = props;
  const mapCreation = state.mapCreation;
  const map = state.map;
  if (!mapCreation || !map || !onSetSetupDraft) return <p>Der Kartenbauzustand ist nicht verfügbar.</p>;
  const draft = setupDraft ?? { mode: "PEN" as const, strokes: [] };
  const edges = setupEdges(draft.strokes, map.width, map.height);
  const stagePoiType: Partial<Record<MapCreationStage, PointOfInterestType>> = {
    [MapCreationStage.PlaceLandmarks]: PointOfInterestType.Landmark,
    [MapCreationStage.PlaceJunctions]: PointOfInterestType.Junction,
    [MapCreationStage.PlaceFortresses]: PointOfInterestType.Fortress,
    [MapCreationStage.PlaceRelics]: PointOfInterestType.Relic,
  };
  const poiType = stagePoiType[mapCreation.stage];
  if (poiType !== undefined) {
    const required = getSetupPoiRequirements(state.players.length)[poiType];
    const label = poiType === PointOfInterestType.Landmark ? "Wahrzeichen" : poiType === PointOfInterestType.Junction
      ? "Knotenpunkte" : poiType === PointOfInterestType.Fortress ? "Festungen" : "Relikte";
    return <section className="control-section" aria-label="POIs platzieren">
      <div className="section-kicker">{label} platzieren</div>
      <h3>{name(state.activePlayerId ?? mapCreation.activePlayerId)} ist an der Reihe</h3>
      <p>Noch {required - mapCreation.placedPoiCounts[poiType]} / {required}. Wähle ein beliebiges Kästchen auf der Karte.</p>
      <small>POIs bleiben an ihrer Rasterzelle, auch wenn diese Region später geteilt wird.</small>
    </section>;
  }

  let previewCount = mapCreation.regionCount;
  let previewValid = false;
  let previewMessage = "Zeichne einen oder mehrere Grenzstriche.";
  try {
    const keys = normalizeSetupBorderEdges(map, edges);
    const current = deriveSetupRegions(map, mapCreation.borders);
    const edgeKeys = draft.mode === "CORRECTION"
      ? (() => {
        const next = new Set(mapCreation.borders.edgeKeys);
        for (const key of keys) next.has(key) ? next.delete(key) : next.add(key);
        return [...next];
      })()
      : [...new Set([...mapCreation.borders.edgeKeys, ...keys])];
    const after = deriveSetupRegions(map, { edgeKeys });
    previewCount = after.length;
    const minimum = getMinimumTerritoryArea(map.format);
    const tooSmall = after.find((region) => region.cells.length < minimum);
    if (tooSmall !== undefined) previewMessage = "Ungültig: " + tooSmall.id + " hätte nur " + tooSmall.cells.length + " / " + minimum + " Kästchen.";
    else if (draft.mode === "CORRECTION") {
      previewValid = edges.length > 0 && after.length === current.length;
      previewMessage = previewValid ? "Korrektur erhält die Gebietszahl." : "Ungültig: Eine Korrektur darf die Gebietszahl nicht ändern.";
    } else {
      const change = analyzeSetupPartitionChange(current, after);
      previewValid = edges.length > 0 && change.validSingleSplit;
      previewMessage = previewValid ? "Gültig: Genau eine Region wird geteilt." : previewCount > mapCreation.regionCount + 1
        ? "Ungültige Teilung: Ein Zeichenzug darf nur ein zusätzliches Gebiet erzeugen."
        : "Der Entwurf muss genau eine Region in zwei Regionen teilen.";
    }
  } catch {
    previewMessage = "Ungültige Grenzsegmente.";
  }

  const clear = () => onSetSetupDraft({ mode: draft.mode, strokes: [] });
  const undo = () => onSetSetupDraft({
    ...draft,
    strokes: draft.strokes.length === 0 ? [] : draft.strokes[draft.strokes.length - 1]!.length > 1
      ? [...draft.strokes.slice(0, -1), draft.strokes[draft.strokes.length - 1]!.slice(0, -1)]
      : draft.strokes.slice(0, -1),
  });
  const correction = draft.mode === "CORRECTION";
  const commit = () => {
    if (correction) {
      const existing = new Set(mapCreation.borders.edgeKeys);
      onAction({ type: GameActionType.CorrectSetupBorders, playerId: mapCreation.activePlayerId,
        addEdges: edges.filter((edge) => !existing.has(toSetupBorderEdgeKey(edge.from, edge.to))),
        removeEdges: edges.filter((edge) => existing.has(toSetupBorderEdgeKey(edge.from, edge.to))),
      });
    } else onAction({ type: GameActionType.CommitSetupBoundaryDraft, playerId: mapCreation.activePlayerId, edges });
  };

  if (mapCreation.stage === MapCreationStage.ReadyToFinalize && !correction) {
    return <section className="control-section" aria-label="Karte prüfen">
      <div className="section-kicker">Karte prüfen</div>
      <h3>Gebiete: {mapCreation.regionCount} / {mapCreation.targetTerritoryCount}</h3>
      <p>{setupValidationIssues.length === 0 ? "✓ Alle Regionen erfüllen Fläche, Zusammenhang und Nachbarschaft." : "Die Karte benötigt noch Korrekturen:"}</p>
      {setupValidationIssues.length > 0 && <ul className="validation-list">{setupValidationIssues.map((issue, index) => <li key={String(issue.territoryId) + "-" + index}>✗ {issue.message}</li>)}</ul>}
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={() => onSetSetupDraft({ mode: "CORRECTION", strokes: [] })}>Korrektur</button>
        <button type="button" className="primary-button" disabled={setupValidationIssues.length > 0}
          onClick={() => onAction({ type: GameActionType.FinalizeMapCreation, playerId: mapCreation.activePlayerId })}>Karte abschließen</button>
      </div>
    </section>;
  }

  return <section className="control-section" aria-label="Kartenbau">
    <div className="section-kicker">Kartenbau</div>
    <h3>Gebiete: {mapCreation.regionCount} / {mapCreation.targetTerritoryCount}</h3>
    <p>Aktiver Spieler: {name(mapCreation.activePlayerId)} · Mindestgröße: {getMinimumTerritoryArea(map.format)} Kästchen</p>
    <p>Nächster Meilenstein: {mapCreation.regionCount < state.players.length ? "Wahrzeichen" : mapCreation.regionCount < state.players.length * 2 ? "Knotenpunkte" : mapCreation.regionCount < state.players.length * 3 ? "Festungen" : mapCreation.regionCount < state.players.length * 4 ? "Relikte" : "Karte abschließen"}</p>
    <div className="button-row">
      <button type="button" className={draft.mode === "PEN" ? "selected-button" : "secondary-button"} onClick={() => onSetSetupDraft({ mode: "PEN", strokes: [] })}>Grenzstift</button>
      <button type="button" className={draft.mode === "BRUSH" ? "selected-button" : "secondary-button"} onClick={() => onSetSetupDraft({ mode: "BRUSH", strokes: [] })}>Pinsel</button>
      <button type="button" className={correction ? "selected-button" : "secondary-button"} onClick={() => onSetSetupDraft({ mode: "CORRECTION", strokes: [] })}>Korrektur</button>
    </div>
    <p>Draft: {mapCreation.regionCount} → {previewCount} Gebiete · {previewMessage}</p>
    <small>{draft.mode === "BRUSH" ? "Der Pinsel zeichnet denselben gerasterten Kantenpfad mit großzügiger Drag-Eingabe." : "Zum Zeichnen auf der Karte ziehen. Diagonale Bewegungen werden in orthogonale Rasterkanten zerlegt."}</small>
    <div className="button-row">
      <button type="button" className="secondary-button" disabled={edges.length === 0} onClick={undo}>Rückgängig</button>
      <button type="button" className="secondary-button" disabled={edges.length === 0} onClick={clear}>Draft löschen</button>
      <button type="button" className="primary-button" disabled={!previewValid} onClick={commit}>{correction ? "Korrektur übernehmen" : "Teilung bestätigen"}</button>
      {correction && mapCreation.stage === MapCreationStage.ReadyToFinalize && <button type="button" className="secondary-button" onClick={() => onSetSetupDraft({ mode: "PEN", strokes: [] })}>Korrektur schließen</button>}
    </div>
  </section>;
}
function FinishedSetupControls(props: ControlProps) {
  const { state, onAction, privacyPlayerId, factionVisible, onSetPrivacyPlayerId, onSetFactionVisible } = props;
  if (state.lastSetupPlayerId === undefined) return <p>Dieser Debug-Zustand ist bereits vorbereitet.</p>;
  const viewer = state.players.find((player) => player.id === privacyPlayerId) ?? state.players[0];
  return <section className="control-section" aria-label="Geheime Fraktionen">
    <div className="section-kicker">Kartenbau abgeschlossen</div>
    <h3>Geheime Fraktionen</h3>
    <Field label="Bildschirm weitergeben an"><select value={viewer?.id ?? ""} onChange={(event) => { onSetPrivacyPlayerId?.(event.target.value); onSetFactionVisible?.(false); }}>
      {state.players.map((player) => <option key={player.id} value={player.id}>{player.name ?? player.id}</option>)}</select></Field>
    {!factionVisible ? <><p>Gib den Bildschirm an {viewer?.name ?? viewer?.id}.</p><button type="button" className="primary-button" onClick={() => onSetFactionVisible?.(true)}>Meine Fraktion anzeigen</button></> : <>
      <p className="secret-faction">{viewer?.secretFactionSuit ? `${suitSymbol(viewer.secretFactionSuit)} ${suitName(viewer.secretFactionSuit).toUpperCase()}` : "Keine Fraktion"}</p>
      <button type="button" className="secondary-button" onClick={() => onSetFactionVisible?.(false)}>Wieder verdecken</button>
    </>}
    <button type="button" className="primary-button" onClick={() => onAction({ type: GameActionType.BeginStartAuctions })}>Startauktionen beginnen</button>
  </section>;
}

function PhaseControls(props: ControlProps) {
  const { state, onAction, onStartRound, playerName: name } = props;
  if (state.pendingSplit) return <SplitEditor {...props} />;
  if (state.auction) return <AuctionBidControls state={state} onAction={onAction} />;
  if (state.pendingWar) return <WarControls state={state} editor={props.editor} onAction={onAction} />;
  if (state.pendingDiamondBorderChanges.length > 0) return <NeutralDiamondControls state={state} editor={props.editor} onAction={onAction} />;
  switch (state.phase) {
    case GamePhase.Setup:
      return <FinishedSetupControls {...props} />;
    case GamePhase.MapCreation:
      return <SetupControls {...props} />;
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
      return <ScoringPanel state={state} playerName={name} onAction={onAction} />;
    case GamePhase.Finished:
      return <ResultPanel state={state} playerName={name} />;
  }
}

export default function App() {
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [scenario, setScenario] = useState<ScenarioKind | null>(null);
  const [showNewGameConfig, setShowNewGameConfig] = useState(false);
  const [showDebugScenarios, setShowDebugScenarios] = useState(false);
  const [newGamePlayers, setNewGamePlayers] = useState<readonly NewGamePlayerInput[]>(DEFAULT_PLAYERS);
  const [firstMapDrawerKey, setFirstMapDrawerKey] = useState(DEFAULT_PLAYERS[0]!.key);
  const [view, setView] = useState<PlayerGameView | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | undefined>();
  const [showHidden, setShowHidden] = useState(false);
  const [showScoreLabels, setShowScoreLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const [mapDraft, setMapDraft] = useState<{ key: string; keys: readonly string[] } | null>(null);
  const [setupDraft, setSetupDraft] = useState<SetupDraft>({ mode: "PEN", strokes: [] });
  const [privacyPlayerId, setPrivacyPlayerId] = useState<string | undefined>();
  const [factionVisible, setFactionVisible] = useState(false);
  const [multiplayer, setMultiplayer] = useState<MultiplayerSession | null>(null);
  const [multiplayerRoom, setMultiplayerRoom] = useState<PublicRoomState | undefined>();
  const [multiplayerName, setMultiplayerName] = useState("Anna");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [showMultiplayer, setShowMultiplayer] = useState(false);
  const [lobbyOrder, setLobbyOrder] = useState<readonly string[]>([]);
  const [firstMultiplayerDrawerId, setFirstMultiplayerDrawerId] = useState<string | undefined>();
  const runtime = useRef<Runtime | null>(null);
  const controller = useRef<GameController | null>(null);
  const unsubscribeController = useRef<(() => void) | null>(null);
  const newSeatIndex = useRef(4);

  // Render helpers still use the established GameState-shaped component API.
  // In remote mode this value originates solely from PlayerGameView.
  const state = view as GameState | null;

  const activateController = (nextController: GameController, remote: boolean) => {
    unsubscribeController.current?.();
    controller.current?.dispose();
    controller.current = nextController;
    if (remote) setView(null);
    else {
      setMultiplayer(null);
      setMultiplayerRoom(undefined);
      rememberMultiplayerSession(undefined);
    }
    unsubscribeController.current = nextController.subscribe((snapshot) => {
      if (snapshot.view !== undefined) setView(snapshot.view);
      const room = (snapshot as { readonly room?: PublicRoomState }).room;
      if (room !== undefined) {
        setMultiplayerRoom(room);
        setLobbyOrder((current) => {
          const playerIds = room.players.map((player) => player.playerId);
          const retained = current.filter((id) => playerIds.includes(id));
          return [...retained, ...playerIds.filter((id) => !retained.includes(id))];
        });
        setFirstMultiplayerDrawerId((current) => current !== undefined && room.players.some((player) => player.playerId === current)
          ? current : room.players[0]?.playerId);
      }
    });
  };

  const connectMultiplayer = async (session: MultiplayerSession) => {
    const remote = new RemoteGameController(session, multiplayerSocketUrl(SERVER_BASE_URL));
    setMultiplayer(session);
    setScenario(null);
    setShowNewGameConfig(false);
    setShowDebugScenarios(false);
    setShowMultiplayer(true);
    setSelectedTerritoryId(undefined);
    setSetupDraft({ mode: "PEN", strokes: [] });
    setSplitDraft(null);
    setMapDraft(null);
    setPrivacyPlayerId(session.playerId);
    setFactionVisible(false);
    rememberMultiplayerSession(session);
    activateController(remote, true);
    await remote.connect();
    setError(null);
  };

  useEffect(() => {
    let disposed = false;
    const saved = storedMultiplayerSession();
    if (saved !== undefined) void connectMultiplayer(saved).catch((caught) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => {
      disposed = true;
      unsubscribeController.current?.();
      controller.current?.dispose();
    };
  }, []);

  const loadScenario = (kind: ScenarioKind, chosenSeed: number) => {
    try {
      const demo = createScenario(kind, chosenSeed);
      runtime.current = { randomSource: demo.randomSource, cardSource: demo.cardSource };
      activateController(new LocalGameController(demo.state, {
        randomSource: demo.randomSource,
        cardSource: demo.cardSource,
        timestamp: nextTimestamp,
      }), false);
      setSplitDraft(null);
      setMapDraft(null);
      setSetupDraft({ mode: "PEN", strokes: [] });
      setFactionVisible(false);
      setPrivacyPlayerId(undefined);
      setShowScoreLabels(false);
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
  const createMultiplayerRoom = async () => {
    try {
      const session = await postMultiplayer<MultiplayerSession>("/api/rooms", { playerName: multiplayerName });
      await connectMultiplayer(session);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const joinMultiplayerRoom = async () => {
    try {
      const roomId = joinRoomCode.trim().toUpperCase();
      if (roomId.length === 0) throw new Error("Bitte einen Raumcode eingeben.");
      const session = await postMultiplayer<MultiplayerSession>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { playerName: multiplayerName });
      await connectMultiplayer(session);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const startMultiplayerRoom = async () => {
    if (multiplayer === null || multiplayerRoom === undefined || firstMultiplayerDrawerId === undefined) return;
    try {
      await postMultiplayer(`/api/rooms/${encodeURIComponent(multiplayer.roomId)}/start`, {
        sessionToken: multiplayer.sessionToken,
        playerOrder: lobbyOrder,
        firstMapDrawerPlayerId: firstMultiplayerDrawerId,
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const moveLobbyPlayer = (playerId: string, direction: -1 | 1) => {
    setLobbyOrder((current) => {
      const index = current.indexOf(playerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const startConfiguredGame = () => {
    const selected = selectedSeed();
    if (selected === undefined) return;
    if (newGamePlayers.length < 2 || newGamePlayers.length > 6 || newGamePlayers.some((player) => player.name.trim().length === 0)) {
      setError("Bitte 2 bis 6 Spieler mit Namen eingeben.");
      return;
    }
    try {
      const players = newGamePlayers.map((player, index) => ({ id: `player-${index + 1}`, name: player.name.trim() }));
      const drawerIndex = Math.max(0, newGamePlayers.findIndex((player) => player.key === firstMapDrawerKey));
      const firstPlayerId = players[drawerIndex]!.id;
      const initial = createGameState({ gameId: `vedras-local-${selected}`, players, startPlayerId: players[0]!.id });
      const randomSource = new SeededRandomSource(selected);
      const cardSource = new DemoCardSource();
      const opened = applyAction(initial, { type: GameActionType.BeginMapCreation, firstPlayerId,
        map: DIGITAL_MAP_CONFIG }, { randomSource, cardSource, timestamp: nextTimestamp(initial) });
      runtime.current = { randomSource, cardSource };
      activateController(new LocalGameController(opened.state, { randomSource, cardSource, timestamp: nextTimestamp }), false);
      setScenario(null);
      setSeed(selected);
      setSplitDraft(null);
      setMapDraft(null);
      setSetupDraft({ mode: "PEN", strokes: [] });
      setSelectedTerritoryId(undefined);
      setShowNewGameConfig(false);
      setShowDebugScenarios(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof DomainError ? caught.message : String(caught));
    }
  };
  const dispatch = (action: GameAction) => {
    if (!state || controller.current === null) return;
    void controller.current.dispatch(action).then(() => {
      if (action.type === GameActionType.CommitSetupBoundaryDraft || action.type === GameActionType.CorrectSetupBorders ||
          action.type === GameActionType.PlaceSetupPointOfInterest) {
        setSetupDraft({ mode: "PEN", strokes: [] });
      }
      if (action.type === GameActionType.FinalizeMapCreation) {
        setSetupDraft({ mode: "PEN", strokes: [] });
        setPrivacyPlayerId(multiplayer?.playerId ?? state.players[0]?.id);
        setFactionVisible(false);
      }
      setError(null);
    }).catch((caught) => {
      setError(caught instanceof DomainError ? caught.code : String(caught));
    });
  };
  const beginRound = () => {
    dispatch({ type: GameActionType.StartRound });
  };
  const reset = () => {
    if (scenario && window.confirm("Aktuelles Demo-Spiel wirklich zurücksetzen?")) loadScenario(scenario, seed);
  };
  const name = (id: string) => state ? playerName(state, id) : id;
  const highlightedIds = state?.phase === GamePhase.ActivationPhase
    ? getAvailableActivationTerritoryIds(state) : [];
  const split = state?.pendingSplit;
  const editorBase = state ? getMapEditor(state, []) : undefined;
  const editor = state ? getMapEditor(state, mapDraft && mapDraft.key === editorBase?.key ? mapDraft.keys : []) : undefined;
  const toggleMapCell = (cell: GridCell) => {
    if (!editor) return;
    if (!editor.selectable.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) return;
    const key = `${cell.x},${cell.y}`;
    const current = editor.selected.map((item) => `${item.x},${item.y}`);
    setMapDraft({ key: editor.key, keys: current.includes(key) ? current.filter((item) => item !== key) : [...current, key] });
  };
  const mapCreation = state?.mapCreation;
  const setupPoiType: Partial<Record<MapCreationStage, PointOfInterestType>> = {
    [MapCreationStage.PlaceLandmarks]: PointOfInterestType.Landmark,
    [MapCreationStage.PlaceJunctions]: PointOfInterestType.Junction,
    [MapCreationStage.PlaceFortresses]: PointOfInterestType.Fortress,
    [MapCreationStage.PlaceRelics]: PointOfInterestType.Relic,
  };
  const setupSelectable = (() => {
    if (!state?.map || !mapCreation) return [] as GridCell[];
    const poiType = setupPoiType[mapCreation.stage];
    if (poiType !== undefined) return Object.keys(state.map.cells).map(fromCellKey);
    if (mapCreation.stage === MapCreationStage.ReadyToFinalize && setupDraft.mode !== "CORRECTION") return [] as GridCell[];
    return mapCreation.stage === MapCreationStage.DrawTerritories || mapCreation.stage === MapCreationStage.ReadyToFinalize
      ? Object.keys(state.map.cells).map(fromCellKey) : [] as GridCell[];
  })();
  const setupEditor = mapCreation && state?.map ? {
    mode: setupPoiType[mapCreation.stage] ? "POI" as const : setupDraft.mode,
    selectable: setupSelectable,
    selected: setupDraft.strokes.flat().map(fromCellKey),
  } : undefined;
  const selectSetupCell = (cell: GridCell, additive: boolean) => {
    if (!state || !mapCreation) return;
    const poiType = setupPoiType[mapCreation.stage];
    if (poiType !== undefined) {
      dispatch({ type: GameActionType.PlaceSetupPointOfInterest, playerId: mapCreation.activePlayerId, poiType, position: cell });
      return;
    }
    const key = String(cell.x) + "," + cell.y;
    setSetupDraft((current) => {
      if (!additive || current.strokes.length === 0) return { ...current, strokes: [...current.strokes, [key]] };
      const last = current.strokes[current.strokes.length - 1]!;
      return last[last.length - 1] === key ? current : { ...current, strokes: [...current.strokes.slice(0, -1), [...last, key]] };
    });
  };  const setupValidationIssues = state?.phase === GamePhase.MapCreation ? getSetupMapValidationIssues(state) : [];
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
  const scoring = state?.scoring;
  const realmHighlights = scoring ? (() => {
    const ids = new Set<string>();
    for (const candidateIds of Object.values(scoring.largestRealmCandidateIdsByPlayerId)) {
      for (const componentId of candidateIds ?? []) ids.add(componentId);
    }
    for (const componentId of Object.values(scoring.selectedLargestRealmComponentIdByPlayerId)) if (componentId !== undefined) ids.add(componentId);
    return scoring.realmComponents.filter((component) => ids.has(component.id)).map((component) => ({
      componentId: component.id,
      territoryIds: component.territoryIds,
      selected: Object.values(scoring.selectedLargestRealmComponentIdByPlayerId).includes(component.id),
    }));
  })() : undefined;
  const scoreHundredthsByTerritoryId = state?.result ? Object.fromEntries(state.result.playerResults.flatMap((player) =>
    player.territoryScores.map((score) => [score.territoryId, score.scoreHundredths]))) : undefined;

  return <div className="app-shell">
    {!state ? <main className="welcome-screen">
      <span className="eyebrow">{showMultiplayer ? "Mehrspieler" : "Lokales Pass-and-Play"}</span>
      <h1>Vedras Reiche</h1>
      <p>{showMultiplayer ? "Der Spielserver verwaltet die Partie. Dein Browser zeigt nur deine eigene Spielansicht." : "Erstelle eine regelkonforme Partie oder öffne ein vorbereitetes Debug-Szenario."}</p>
      {!showNewGameConfig && !showDebugScenarios && !showMultiplayer && <div className="button-row welcome-actions">
        <button type="button" className="primary-button" onClick={() => setShowNewGameConfig(true)}>Neues Spiel</button>
        <button type="button" className="secondary-button" onClick={() => setShowMultiplayer(true)}>Mehrspieler</button>
        <button type="button" className="secondary-button" onClick={() => setShowDebugScenarios(true)}>Debug-Szenarien</button>
      </div>}
      {showMultiplayer && <section className="new-game-config panel multiplayer-panel">
        <div className="panel-heading"><div><span className="section-kicker">Mehrspieler</span><h2>{multiplayerRoom ? `Raum ${multiplayerRoom.roomId}` : "Gemeinsame Partie"}</h2></div>
          {!multiplayer && <button type="button" className="text-button" onClick={() => setShowMultiplayer(false)}>Schließen</button>}</div>
        {multiplayerRoom === undefined ? <div className="config-stack">
          <Field label="Name"><input value={multiplayerName} maxLength={80} onChange={(event) => setMultiplayerName(event.target.value)} /></Field>
          <div className="button-row"><button type="button" className="primary-button" onClick={() => void createMultiplayerRoom()}>Spiel erstellen</button></div>
          <div className="join-room-row"><Field label="Raumcode"><input value={joinRoomCode} maxLength={8} placeholder="ABC123" onChange={(event) => setJoinRoomCode(event.target.value.toUpperCase())} /></Field>
            <button type="button" className="secondary-button" onClick={() => void joinMultiplayerRoom()}>Raum beitreten</button></div>
          {multiplayer && <p className="muted">Verbindung wird wiederhergestellt …</p>}
        </div> : <div className="config-stack">
          <p className="room-code">Raumcode: <strong>{multiplayerRoom.roomId}</strong></p>
          <div className="lobby-player-list">{lobbyOrder.map((playerId, index) => {
            const player = multiplayerRoom.players.find((item) => item.playerId === playerId);
            if (player === undefined) return null;
            const host = multiplayerRoom.hostPlayerId === multiplayer?.playerId;
            return <div key={playerId} className="lobby-player"><span>{index + 1}. {player.name} {player.connected ? "✓" : "○"}</span>
              {host && <span className="button-row"><button type="button" className="secondary-button" disabled={index === 0} onClick={() => moveLobbyPlayer(playerId, -1)}>↑</button><button type="button" className="secondary-button" disabled={index === lobbyOrder.length - 1} onClick={() => moveLobbyPlayer(playerId, 1)}>↓</button></span>}
            </div>;
          })}</div>
          {multiplayerRoom.hostPlayerId === multiplayer?.playerId ? <>
            <Field label="Erster Kartenzeichner"><select value={firstMultiplayerDrawerId ?? ""} onChange={(event) => setFirstMultiplayerDrawerId(event.target.value)}>{lobbyOrder.map((playerId) => {
              const player = multiplayerRoom.players.find((item) => item.playerId === playerId);
              return player ? <option key={playerId} value={playerId}>{player.name}</option> : null;
            })}</select></Field>
            <button type="button" className="primary-button" disabled={multiplayerRoom.players.length < 2 || firstMultiplayerDrawerId === undefined} onClick={() => void startMultiplayerRoom()}>Spiel starten</button>
          </> : <p className="muted">Der Host legt Reihenfolge und ersten Kartenzeichner fest.</p>}
        </div>}
      </section>}
      {showNewGameConfig && <section className="new-game-config panel">
        <div className="panel-heading"><div><span className="section-kicker">Neues Spiel</span><h2>Partie konfigurieren</h2></div>
          <button type="button" className="text-button" onClick={() => setShowNewGameConfig(false)}>Schließen</button></div>
        <div className="config-stack">
          <div><strong>Spielreihenfolge</strong><small>Die angezeigte Reihenfolge bleibt für die ganze Partie bestehen.</small></div>
          {newGamePlayers.map((player, index) => <div key={player.key} className="seat-entry">
            <strong>{index + 1}</strong><input aria-label={`Name Spieler ${index + 1}`} value={player.name} onChange={(event) => setNewGamePlayers((current) => current.map((item) => item.key === player.key ? { ...item, name: event.target.value } : item))} />
            <button type="button" className="secondary-button" disabled={index === 0} onClick={() => setNewGamePlayers((current) => {
              const next = [...current]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next;
            })}>↑</button>
            <button type="button" className="secondary-button" disabled={index === newGamePlayers.length - 1} onClick={() => setNewGamePlayers((current) => {
              const next = [...current]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; return next;
            })}>↓</button>
            <button type="button" className="text-button" disabled={newGamePlayers.length <= 2} onClick={() => setNewGamePlayers((current) => current.filter((item) => item.key !== player.key))}>Entfernen</button>
          </div>)}
          <button type="button" className="secondary-button" disabled={newGamePlayers.length >= 6} onClick={() => {
            const key = `seat-${newSeatIndex.current++}`; setNewGamePlayers((current) => [...current, { key, name: `Spieler ${current.length + 1}` }]);
          }}>Spieler hinzufügen</button>
          <div className="config-grid">
            <div className="digital-profile" aria-label="Digitales Regelprofil"><strong>Digitales Spielfeld</strong><span>{DIGITAL_BOARD_WIDTH} × {DIGITAL_BOARD_HEIGHT} Kästchen</span><small>Mindestgebiet: {DIGITAL_MIN_TERRITORY_AREA} Kästchen</small></div>
            <Field label="Wer beginnt mit dem Kartenzeichnen?"><select value={firstMapDrawerKey} onChange={(event) => setFirstMapDrawerKey(event.target.value)}>{newGamePlayers.map((player) => <option key={player.key} value={player.key}>{player.name || "Ohne Namen"}</option>)}</select></Field>
          </div>
          <Field label="Lokaler Seed (für reproduzierbare Ziehungen)"><input type="number" min="0" step="1" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} /></Field>
          <small>Das digitale Regelprofil ist festgelegt und gilt für die gesamte Partie.</small>
          <button type="button" className="primary-button" onClick={startConfiguredGame}>Kartenbau starten</button>
        </div>
      </section>}
      {showDebugScenarios && <section className="debug-welcome">
        <div className="panel-heading"><div><span className="section-kicker">Debug-Szenarien</span><h2>Schnelle Testzustände</h2></div><button type="button" className="text-button" onClick={() => setShowDebugScenarios(false)}>Schließen</button></div>
        <Field label="Debug-Seed"><input type="number" min="0" step="1" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} /></Field>
        <div className="scenario-grid">{SCENARIOS.map((item) => <button type="button" key={item.kind} className="scenario-tile" onClick={() => startSelectedScenario(item.kind)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}</div>
      </section>}
      {error && <p role="alert" className="error-banner">Aktion nicht möglich: {error}</p>}
    </main> : <>
      <GameHeader state={state} playerName={name} mode={multiplayer ? "MULTIPLAYER" : "LOCAL"} />
      <main className="dashboard">
        <section className="toolbar panel">
          <div><span className="section-kicker">{multiplayer ? "Mehrspieler" : scenario ? "Debug-Szenario" : "Lokale Partie"}</span><strong>{multiplayer ? `Raum ${multiplayer.roomId}` : `Seed ${seed}`}</strong></div>
          {scenario ? <>
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
          </> : <p className="muted">{multiplayer ? `Server-Revision ${controller.current?.getSnapshot().revision ?? 0}` : "Kartenbau und Spielablauf verwenden den echten Game Core."}</p>}
          {state.phase === GamePhase.Finished && <label className="debug-toggle"><input type="checkbox" checked={showScoreLabels}
            onChange={(event) => setShowScoreLabels(event.target.checked)} /> Wertungsansicht auf der Karte</label>}
        </section>
        {error && <div role="alert" className="error-banner">Aktion nicht möglich: <strong>{error}</strong></div>}
        <div className="main-grid">
          <div className="board-column panel">
            <div className="panel-heading"><span className="section-kicker">Spielbrett</span><h2>Gebietsübersicht</h2></div>
            <TerritoryBoard state={state} selectedId={selectedTerritoryId}
              onSelect={setSelectedTerritoryId} highlightedIds={highlightedIds} playerName={name}
              splitDraft={currentSplitDraft} onToggleSplitCell={toggleSplitCell}
              editor={editor} onToggleMapCell={toggleMapCell} realmHighlights={realmHighlights}
              scoreHundredthsByTerritoryId={scoreHundredthsByTerritoryId} showScoreLabels={showScoreLabels}
              setupEditor={setupEditor} onSetupSelectCell={selectSetupCell} />
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
            onSetOriginalCardPart={setOriginalCardPart} editor={editor} playerName={name}
            setupDraft={setupDraft} onSetSetupDraft={setSetupDraft} setupValidationIssues={setupValidationIssues}
            privacyPlayerId={privacyPlayerId} factionVisible={factionVisible}
            onSetPrivacyPlayerId={setPrivacyPlayerId} onSetFactionVisible={setFactionVisible} />
            <RecentWarResult state={state} /></ActionPanel>
          <div className="panel"><EventLog events={state.events} playerName={name} /></div>
        </div>
        {!multiplayer && <div className="inspector-row panel">
          <label className="debug-toggle"><input type="checkbox" checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)} /> Verdeckte Informationen anzeigen</label>
          <StateInspector state={state} showHidden={showHidden} />
          <button type="button" className="text-button" onClick={() => dispatch({
            type: GameActionType.OpenAuction, playerId: "__ungueltig__", territoryId: state.territories[0]?.id ?? "",
          })}>Ungültige Aktion testen</button>
        </div>}
      </main>
    </>}
  </div>;
}
