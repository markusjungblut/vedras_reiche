import { useEffect, useRef, useState } from "react";
import {
  applyAction,
  createGameState,
  GameActionType,
  GamePhase,
  DIGITAL_BOARD_HEIGHT,
  DIGITAL_BOARD_WIDTH,
  DIGITAL_MAP_CONFIG,
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
import { RemoteGameController, type MultiplayerCredentials, type RemoteConnectionStatus } from "./controllers/remote-game-controller";
import { mergeDraftEdges } from "./map/setup-draft";
import type { PublicRoomState } from "@vedras/protocol";
import { FirstGameHint } from "./components/FirstGameHint";
import { HelpDrawer } from "./components/HelpDrawer";
import { IntroductionTour } from "./components/IntroductionTour";
import { formatDomainError, type RuleHelpId } from "./help/rule-help";
import { loadTutorialProgress, markIntroductionSeen, markTutorialSeen, resetTutorialProgress, type TutorialStep } from "./help/tutorial-state";

const DEFAULT_SEED = 12345;
const SERVER_BASE_URL = import.meta.env.VITE_SERVER_URL ?? window.location.origin;
const MULTIPLAYER_SESSIONS_KEY = "vedras-reiche-multiplayer-sessions";
const MULTIPLAYER_LAST_ROOM_KEY = "vedras-reiche-last-multiplayer-room";
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

type SetupMode = "PEN" | "ERASER" | "CORRECTION";

interface SetupDraft {
  readonly mode: SetupMode;
  /** Local, zero-area border edges. The authoritative state changes only at commit. */
  readonly strokes: readonly (readonly SetupBorderEdge[])[];
  readonly activeStroke?: readonly SetupBorderEdge[] | undefined;
}

interface NewGamePlayerInput { readonly key: string; readonly name: string; }

interface MultiplayerSession extends MultiplayerCredentials {
  readonly playerName?: string;
}

function multiplayerSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

function isMultiplayerSession(value: unknown): value is MultiplayerSession {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<MultiplayerSession>;
  return typeof candidate.roomId === "string" && typeof candidate.playerId === "string" && typeof candidate.sessionToken === "string" &&
    (candidate.playerName === undefined || typeof candidate.playerName === "string");
}

function storedMultiplayerSessions(): Readonly<Record<string, MultiplayerSession>> {
  try {
    const stored = localStorage.getItem(MULTIPLAYER_SESSIONS_KEY);
    if (stored === null) return {};
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, session]) => isMultiplayerSession(session))) as Readonly<Record<string, MultiplayerSession>>;
  } catch {
    return {};
  }
}

function lastStoredMultiplayerSession(sessions = storedMultiplayerSessions()): MultiplayerSession | undefined {
  try {
    const roomId = localStorage.getItem(MULTIPLAYER_LAST_ROOM_KEY);
    return roomId === null ? undefined : sessions[roomId];
  } catch {
    return undefined;
  }
}

function rememberMultiplayerSession(session: MultiplayerSession): Readonly<Record<string, MultiplayerSession>> {
  const sessions = { ...storedMultiplayerSessions(), [session.roomId]: session };
  try {
    localStorage.setItem(MULTIPLAYER_SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem(MULTIPLAYER_LAST_ROOM_KEY, session.roomId);
  } catch { /* Browser storage is optional for local development. */ }
  return sessions;
}

function forgetMultiplayerSession(roomId: string): Readonly<Record<string, MultiplayerSession>> {
  const sessions = { ...storedMultiplayerSessions() };
  delete sessions[roomId];
  try {
    localStorage.setItem(MULTIPLAYER_SESSIONS_KEY, JSON.stringify(sessions));
    if (localStorage.getItem(MULTIPLAYER_LAST_ROOM_KEY) === roomId) {
      const replacement = Object.keys(sessions).at(-1);
      if (replacement === undefined) localStorage.removeItem(MULTIPLAYER_LAST_ROOM_KEY);
      else localStorage.setItem(MULTIPLAYER_LAST_ROOM_KEY, replacement);
    }
  } catch { /* Browser storage is optional for local development. */ }
  return sessions;
}

function inviteRoomCode(): string | undefined {
  const roomId = new URL(window.location.href).searchParams.get("room")?.trim().toUpperCase();
  return roomId !== undefined && /^[A-Z0-9]{3,32}$/.test(roomId) ? roomId : undefined;
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

function SecretFactionPanel({ state, playerId, visible, onVisibleChange, localPassAndPlay, onPlayerChange }: {
  state: GameState;
  playerId?: string | undefined;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  localPassAndPlay: boolean;
  onPlayerChange: (id: string) => void;
}) {
  if (state.phase === GamePhase.Finished) return null;
  const player = state.players.find((item) => item.id === playerId) ?? state.players[0];
  if (!player?.secretFactionSuit) return null;
  return <section className="panel secret-faction-panel" aria-label="Eigene geheime Fraktion">
    <div className="panel-heading"><div><p className="eyebrow">Persönlich</p><h2>Geheime Fraktion</h2></div></div>
    {localPassAndPlay && <Field label="Bildschirm für"><select value={player.id} onChange={(event) => { onPlayerChange(event.target.value); onVisibleChange(false); }}>
      {state.players.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
    </select></Field>}
    {!visible ? <><p>Nur {player.name} kann diese Information sehen.</p><button type="button" className="primary-button" onClick={() => onVisibleChange(true)}>Fraktion anzeigen</button></>
      : <><p className="secret-faction">{suitSymbol(player.secretFactionSuit)} {suitName(player.secretFactionSuit).toUpperCase()}</p>
        <button type="button" className="secondary-button" onClick={() => onVisibleChange(false)}>Fraktion verbergen</button></>}
  </section>;
}

interface ControlProps {
  readonly state: GameState;
  readonly actionTerritoryId?: string | undefined;
  readonly onSelectActionTerritory: (id: string) => void;
  readonly onAction: (action: GameAction) => void;
  readonly onStartRound: () => void;
  readonly splitDraft?: SplitDraft | undefined;
  readonly onToggleSplitCell: (cell: GridCell) => void;
  readonly onSetOriginalCardPart: (part: "A" | "B") => void;
  readonly editor?: MapEditor | undefined;
  readonly playerName: (id: string) => string;
  readonly setupDraft?: SetupDraft | undefined;
  readonly onSetSetupDraft?: (draft: SetupDraft) => void;
  readonly setupCanEdit?: boolean;
  readonly setupValidationIssues?: ReturnType<typeof getSetupMapValidationIssues>;
  readonly privacyPlayerId?: string | undefined;
  readonly viewerPlayerId?: string | undefined;
  readonly factionVisible?: boolean;
  readonly onSetPrivacyPlayerId?: (id: string) => void;
  readonly onSetFactionVisible?: (visible: boolean) => void;
  readonly selectedPart?: "A" | "B" | undefined;
  readonly onSelectPart?: (part: "A" | "B") => void;
}

function AuctionBidControls({ state, onAction, viewerPlayerId }: Pick<ControlProps, "state" | "onAction" | "viewerPlayerId">) {
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
  const waitingForAnotherPlayer = viewerPlayerId !== undefined && nextBidderId !== undefined && nextBidderId !== viewerPlayerId;

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
    {nextBidderId !== undefined && waitingForAnotherPlayer && <p className="winner-message">Gebot abgegeben. Warte auf andere Spieler …</p>}
    {nextBidderId !== undefined && !waitingForAnotherPlayer && <div className="bid-entry" key={`${auction.id}:${nextBidderId}`}>
      <strong>{viewerPlayerId === nextBidderId ? "Du gibst jetzt ein Gebot ab" : `${playerName(state, nextBidderId)} gibt jetzt ein Gebot ab`}</strong>
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

function SplitEditor({ state, onAction, splitDraft, onToggleSplitCell, onSetOriginalCardPart, selectedPart, onSelectPart, viewerPlayerId }: ControlProps) {
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
  const minimum = getMinimumTerritoryArea(map);
  const validation = validateTerritorySplit(map, original.id, partA, minimum);
  const partAConnected = areCellsOrthogonallyConnected(partA);
  const partBConnected = areCellsOrthogonallyConnected(validation.partBCells);
  const divider = split.dividerPlayerId;
  const chooser = split.firstChooserPlayerId;
  const mayDivide = viewerPlayerId === undefined || viewerPlayerId === divider;
  const mayChoose = viewerPlayerId === undefined || viewerPlayerId === chooser;
  if (split.stage === "AWAITING_CHOICE" && split.proposal) {
    const otherPart = selectedPart === "A" ? "B" : "A";
    return <section className="control-section" aria-label="Gebietsteilung auswählen">
      <div className="section-kicker">Cut and Choose · Auswahl</div>
      <h3>{chooser ? `${playerName(state, chooser)} wählt zuerst` : "Auswahl steht an"}</h3>
      <p>{chooser ? `${playerName(state, chooser)} wählt jetzt einen Teil.` : "Wähle einen Teil."} Teil A und B sind direkt auf der Karte markiert.</p>
      <p>Teil A: {split.proposal.partACells.length} · Teil B: {split.proposal.partBCells.length} Kästchen.</p>
      {!mayChoose ? <p className="winner-message">Warte auf die Auswahl von {playerName(state, chooser ?? "")}.</p> : <div className="button-row">
        {(["A", "B"] as const).map((part) => <button key={part} type="button" className={selectedPart === part ? "selected-button" : "secondary-button"}
          onClick={() => onSelectPart?.(part)}>Teil {part} wählen</button>)}
      </div>}
      {mayChoose && selectedPart && <><p className="winner-message">{playerName(state, chooser ?? "")} erhält Teil {selectedPart}. {playerName(state, divider ?? "")} erhält Teil {otherPart}.</p>
        <button type="button" className="primary-button" onClick={() => onAction({ type: GameActionType.ChooseSplitPart,
          splitId: split.id, playerId: chooser ?? "", chosenPart: selectedPart })}>Auswahl bestätigen</button></>}
    </section>;
  }
  return <section className="control-section" aria-label="Gebietsteilung bearbeiten">
    <div className="section-kicker">Cut and Choose · Grenze ziehen</div>
    <h3>{divider ? `${playerName(state, divider)} zieht die Grenze` : "Divider zieht die Grenze"}</h3>
    <p>{chooser ? `${playerName(state, chooser)} wählt anschließend zuerst.` : "Danach wählt der andere Höchstbietende zuerst."} Zeichne eine gültige Grenze direkt auf der Karte.</p>
    <p>Teil A: {partA.length} Kästchen {partA.length >= minimum ? "✓" : `✗ mindestens ${minimum}`} · Zusammenhang {partAConnected ? "✓" : "✗"}</p>
    <p>Teil B: {validation.partBCells.length} Kästchen {validation.partBCells.length >= minimum ? "✓" : `✗ mindestens ${minimum}`} · Zusammenhang {partBConnected ? "✓" : "✗"}</p>
    <p>{validation.valid ? "Beide Teile sind zusammenhängend und regelkonform." : `Noch nicht gültig: ${validation.reason ?? "Mindestgröße oder Zusammenhang fehlt"}.`}</p>
    {!mayDivide && <p className="winner-message">Warte darauf, dass {playerName(state, divider ?? "")} die Grenze zeichnet.</p>}
    <div className="split-cell-grid" aria-label="Zellen des ursprünglichen Gebiets">
      {allCells.map((cell) => {
        const key = `${cell.x},${cell.y}`;
        const inA = partAKeys.includes(key);
        return <button key={key} type="button" disabled={!mayDivide} className={inA ? "split-cell part-a" : "split-cell part-b"} onClick={() => onToggleSplitCell(cell)} aria-label={`Kästchen ${cell.x}, ${cell.y}: Teil ${inA ? "A" : "B"}`}>{inA ? "A" : "B"}</button>;
      })}
    </div>
    <div className="button-row">
      <button type="button" disabled={!mayDivide} className={originalCardPart === "A" ? "selected-button" : "secondary-button"} onClick={() => onSetOriginalCardPart("A")}>Teil A behält die Karte</button>
      <button type="button" disabled={!mayDivide} className={originalCardPart === "B" ? "selected-button" : "secondary-button"} onClick={() => onSetOriginalCardPart("B")}>Teil B behält die Karte</button>
    </div>
    <button type="button" className="primary-button" disabled={!mayDivide || !validation.valid || divider === undefined}
      onClick={() => divider !== undefined && onAction({ type: GameActionType.ProposeTerritorySplit, splitId: split.id, playerId: divider, partACells: partA, originalCardPart })}>Teilung bestätigen</button>
    {allCells.length < 2 * minimum && <button type="button" className="secondary-button"
      onClick={() => onAction({ type: GameActionType.ResolveTerritorySplit, splitId: split.id, resolution: "SPLIT_NOT_POSSIBLE" })}>
      Teilung wegen zu kleiner Fläche unmöglich
    </button>}
  </section>;
}

function ActivationControls({ state, actionTerritoryId, onSelectActionTerritory, onAction }: ControlProps) {
  const availableIds = getAvailableActivationTerritoryIds(state);
  const chosenId = actionTerritoryId && availableIds.includes(actionTerritoryId)
    ? actionTerritoryId : availableIds[0];
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
        onClick={() => onSelectActionTerritory(id)}>{id}</button>)}
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

function ActionControls({ state, actionTerritoryId, onSelectActionTerritory, onAction }: ControlProps) {
  const activePlayerId = state.activePlayerId;
  const targetIds = activePlayerId === undefined ? [] : getPotentialAuctionTerritoryIds(state, activePlayerId);
  const targets = targetIds.map((id) => state.territories.find((territory) => territory.id === id)).filter((territory): territory is Territory => territory !== undefined);
  const wars = activePlayerId === undefined ? [] : getPotentialWarTargets(state, activePlayerId);
  const attackerIds = [...new Set(wars.map((war) => war.attackerTerritoryId))];
  const selectedAttacker = actionTerritoryId && attackerIds.includes(actionTerritoryId)
    ? actionTerritoryId : attackerIds[0];
  const defenderIds = wars.filter((war) => war.attackerTerritoryId === selectedAttacker).map((war) => war.defenderTerritoryId);
  const selectedTargetId = targets.some((item) => item.id === actionTerritoryId)
    ? actionTerritoryId : targets[0]?.id;
  return <section className="control-section" aria-label="Grundaktion">
    <div className="section-kicker">Aktionsphase</div>
    <h3>{activePlayerId ? `${playerName(state, activePlayerId)} ist am Zug` : "Keine aktive Grundaktion"}</h3>
    {activePlayerId && <>
      {state.actionPhase?.secondAuctionAvailable && <p>Nach dem Gleichstand kannst du eine zweite Auktion eröffnen oder den Zug beenden.</p>}
      {targets.length > 0 ? <>
        <p>Neutraler Nachbar für die Auktion:</p>
        <div className="button-row">{targets.map((item) => <button key={item.id} type="button"
          className={item.id === selectedTargetId ? "selected-button" : "secondary-button"}
          onClick={() => onSelectActionTerritory(item.id)}>Auktion um {item.id}</button>)}</div>
        {selectedTargetId && <button type="button" className="primary-button" onClick={() => onAction({ type: GameActionType.OpenAuction,
          playerId: activePlayerId, territoryId: selectedTargetId })}>Auktion um {selectedTargetId} eröffnen</button>}
      </> : <p>Kein angrenzendes neutrales Gebiet verfügbar.</p>}
      {wars.length > 0 ? <>
        <p>Oder einen Krieg beginnen:</p>
        <p>1. Eigenes Angriffsgebiet wählen:</p>
        <div className="button-row">{attackerIds.map((id) => <button key={id} type="button"
          className={id === selectedAttacker ? "selected-button" : "secondary-button"}
          onClick={() => onSelectActionTerritory(id)}>{id}</button>)}</div>
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

function SetupControls(props: ControlProps) {
  const { state, onAction, playerName: name, setupDraft, onSetSetupDraft, setupValidationIssues = [], setupCanEdit = true } = props;
  const mapCreation = state.mapCreation;
  const map = state.map;
  if (!mapCreation || !map || !onSetSetupDraft) return <p>Der Kartenbauzustand ist nicht verfügbar.</p>;
  const draft = setupDraft ?? { mode: "PEN" as const, strokes: [] };
  const edges = mergeDraftEdges([...draft.strokes, ...(draft.activeStroke === undefined ? [] : [draft.activeStroke])]);
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
  let previewAreas = deriveSetupRegions(map, mapCreation.borders).map((region) => region.cells.length);
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
    previewAreas = after.map((region) => region.cells.length);
    const minimum = getMinimumTerritoryArea(map);
    const tooSmall = after.find((region) => region.cells.length < minimum);
    if (tooSmall !== undefined) previewMessage = "Ungültig: " + tooSmall.id + " hätte nur " + tooSmall.cells.length + " / " + minimum + " Kästchen.";
    else if (draft.mode === "CORRECTION") {
      previewValid = edges.length > 0 && after.length === current.length;
      previewMessage = previewValid ? "Korrektur erhält die Gebietszahl." : "Ungültig: Eine Korrektur darf die Gebietszahl nicht ändern.";
    } else {
      const change = analyzeSetupPartitionChange(current, after);
      previewValid = edges.length > 0 && change.validSingleSplit;
      previewMessage = previewValid ? "✓ Gültige Teilung" : previewCount > mapCreation.regionCount + 1
        ? "Ungültig: Dieser Entwurf würde zwei neue Gebiete erzeugen. Pro Zeichenzug ist nur ein neues Gebiet erlaubt."
        : previewCount === mapCreation.regionCount ? "Noch keine vollständige Teilung"
          : "Der Entwurf muss genau eine Region in zwei Regionen teilen.";
    }
  } catch {
    previewMessage = "Ungültige Grenzsegmente.";
  }

  const undo = () => onSetSetupDraft({
    ...draft,
    activeStroke: undefined,
    strokes: draft.strokes.slice(0, -1),
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
        <button type="button" className="secondary-button" disabled={!setupCanEdit} onClick={() => onSetSetupDraft({ mode: "CORRECTION", strokes: [] })}>Korrektur</button>
        <button type="button" className="primary-button" disabled={!setupCanEdit || setupValidationIssues.length > 0}
          onClick={() => onAction({ type: GameActionType.FinalizeMapCreation, playerId: mapCreation.activePlayerId })}>Karte abschließen</button>
      </div>
    </section>;
  }

  return <section className="control-section" aria-label="Kartenbau">
    <div className="section-kicker">Kartenbau</div>
    <h3>Gebiete: {mapCreation.regionCount} / {mapCreation.targetTerritoryCount}</h3>
    <p>Aktiver Spieler: {name(mapCreation.activePlayerId)} · Mindestgröße: {getMinimumTerritoryArea(map)} Kästchen</p>
    <p>Nächster Meilenstein: {mapCreation.regionCount < state.players.length ? "Wahrzeichen" : mapCreation.regionCount < state.players.length * 2 ? "Knotenpunkte" : mapCreation.regionCount < state.players.length * 3 ? "Festungen" : mapCreation.regionCount < state.players.length * 4 ? "Relikte" : "Karte abschließen"}</p>
    <div className="button-row">
      <button type="button" disabled={!setupCanEdit} className={draft.mode === "PEN" ? "selected-button" : "secondary-button"} onClick={() => onSetSetupDraft({ mode: "PEN", strokes: [] })}>Grenzstift</button>
      {!correction && <button type="button" disabled={!setupCanEdit} className={draft.mode === "ERASER" ? "selected-button" : "secondary-button"} onClick={() => onSetSetupDraft({ mode: "ERASER", strokes: draft.strokes })}>Radiergummi</button>}
    </div>
    {!setupCanEdit && <p className="muted">Du bist nicht am Zug. Der Server akzeptiert nur Aktionen des aktiven Spielers.</p>}
    <p>Gebiete aktuell: {mapCreation.regionCount} · Nach diesem Entwurf: {previewCount} · {previewMessage}</p>
    <small>Bestätigte Kanten: {mapCreation.borders.edgeKeys.length} · Draft-Kanten: {edges.length} · Vorschauflächen: {previewAreas.join(" + ")} = {previewAreas.reduce((sum, area) => sum + area, 0)}</small>
    <small>{draft.mode === "ERASER" ? "Der Radiergummi entfernt nur Kanten aus dem aktuellen lokalen Entwurf." : "Der Grenzstift snappt präzise auf Rastervertices und erzeugt nur Kanten zwischen Zellen."}</small>
    <div className="button-row">
      <button type="button" className="secondary-button" disabled={!setupCanEdit || edges.length === 0} onClick={undo}>Rückgängig</button>
      <button type="button" className="primary-button" disabled={!setupCanEdit || !previewValid} onClick={commit}>{correction ? "Korrektur übernehmen" : "Teilung bestätigen"}</button>
      {correction && mapCreation.stage === MapCreationStage.ReadyToFinalize && <button type="button" className="secondary-button" disabled={!setupCanEdit} onClick={() => onSetSetupDraft({ mode: "PEN", strokes: [] })}>Korrektur schließen</button>}
    </div>
  </section>;
}
function FinishedSetupControls(props: ControlProps) {
  const { state, onAction } = props;
  if (state.lastSetupPlayerId === undefined) return <p>Dieser Debug-Zustand ist bereits vorbereitet.</p>;
  return <section className="control-section" aria-label="Kartenbau abgeschlossen">
    <div className="section-kicker">Kartenbau abgeschlossen</div>
    <h3>Startauktionen vorbereiten</h3>
    <p>Prüft eure persönlichen Fraktionen im rechten Bereich, bevor die Startauktionen beginnen.</p>
    <button type="button" className="primary-button" onClick={() => onAction({ type: GameActionType.BeginStartAuctions })}>Startauktionen beginnen</button>
  </section>;
}

function PhaseControls(props: ControlProps) {
  const { state, onAction, onStartRound, playerName: name } = props;
  if (state.pendingSplit) return <SplitEditor {...props} />;
  if (state.auction) return <AuctionBidControls state={state} onAction={onAction} viewerPlayerId={props.viewerPlayerId} />;
  if (state.pendingWar) return <WarControls state={state} editor={props.editor} onAction={onAction}
    viewerPlayerId={props.viewerPlayerId} selectedPart={props.selectedPart} onSelectPart={props.onSelectPart} />;
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
  const [actionTerritoryId, setActionTerritoryId] = useState<string | undefined>();
  const [partChoiceDraft, setPartChoiceDraft] = useState<{ readonly key: string; readonly part: "A" | "B" } | undefined>();
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
  const [joinRoomCode, setJoinRoomCode] = useState(() => inviteRoomCode() ?? "");
  const [showMultiplayer, setShowMultiplayer] = useState(() => inviteRoomCode() !== undefined);
  const [savedMultiplayerSessions, setSavedMultiplayerSessions] = useState<Readonly<Record<string, MultiplayerSession>>>(() => storedMultiplayerSessions());
  const [remoteConnectionStatus, setRemoteConnectionStatus] = useState<RemoteConnectionStatus>("DISCONNECTED");
  const [lobbyOrder, setLobbyOrder] = useState<readonly string[]>([]);
  const [firstMultiplayerDrawerId, setFirstMultiplayerDrawerId] = useState<string | undefined>();
  const [lobbyMap, setLobbyMap] = useState({ width: DIGITAL_BOARD_WIDTH, height: DIGITAL_BOARD_HEIGHT });
  const [tutorialProgress, setTutorialProgress] = useState(loadTutorialProgress);
  const [showIntroduction, setShowIntroduction] = useState(() => !loadTutorialProgress().introductionSeen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState<RuleHelpId | undefined>();
  const runtime = useRef<Runtime | null>(null);
  const controller = useRef<GameController | null>(null);
  const unsubscribeController = useRef<(() => void) | null>(null);
  const newSeatIndex = useRef(4);

  // Render helpers still use the established GameState-shaped component API.
  // In remote mode this value originates solely from PlayerGameView.
  const state = view as GameState | null;

  useEffect(() => {
    const clearInformationalSelection = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedTerritoryId(undefined);
    };
    window.addEventListener("keydown", clearInformationalSelection);
    return () => window.removeEventListener("keydown", clearInformationalSelection);
  }, []);

  const activateController = (nextController: GameController, remote: boolean) => {
    unsubscribeController.current?.();
    controller.current?.dispose();
    controller.current = nextController;
    if (remote) setView(null);
    else {
      setMultiplayer(null);
      setMultiplayerRoom(undefined);
      setRemoteConnectionStatus("DISCONNECTED");
    }
    unsubscribeController.current = nextController.subscribe((snapshot) => {
      if (snapshot.view !== undefined) setView(snapshot.view);
      if (remote && snapshot.connectionStatus !== undefined) {
        setRemoteConnectionStatus(snapshot.connectionStatus);
        if (snapshot.connectionStatus !== "CONNECTED") setSetupDraft({ mode: "PEN", strokes: [] });
      }
      const room = (snapshot as { readonly room?: PublicRoomState }).room;
      if (room !== undefined) {
        setMultiplayerRoom(room);
        setLobbyMap({ width: room.map.width, height: room.map.height });
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
    const storedSession: MultiplayerSession = { ...session, playerName: session.playerName ?? multiplayerName.trim() };
    const remote = new RemoteGameController(storedSession, multiplayerSocketUrl(SERVER_BASE_URL));
    setMultiplayer(storedSession);
    setScenario(null);
    setShowNewGameConfig(false);
    setShowDebugScenarios(false);
    setShowMultiplayer(true);
    setSelectedTerritoryId(undefined);
    setSetupDraft({ mode: "PEN", strokes: [] });
    setSplitDraft(null);
    setMapDraft(null);
    setPrivacyPlayerId(storedSession.playerId);
    setFactionVisible(false);
    setSavedMultiplayerSessions(rememberMultiplayerSession(storedSession));
    activateController(remote, true);
    await remote.connect();
    setError(null);
  };

  useEffect(() => {
    return () => {
      unsubscribeController.current?.();
      controller.current?.dispose();
    };
  }, []);

  const returnToMultiplayerStart = () => {
    unsubscribeController.current?.();
    controller.current?.dispose();
    controller.current = null;
    setView(null);
    setMultiplayer(null);
    setMultiplayerRoom(undefined);
    setRemoteConnectionStatus("DISCONNECTED");
    setShowMultiplayer(true);
    setError(null);
  };

  const forgetSavedMultiplayerSession = (roomId: string) => {
    setSavedMultiplayerSessions(forgetMultiplayerSession(roomId));
    if (multiplayer?.roomId === roomId) returnToMultiplayerStart();
  };

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
      setPrivacyPlayerId(demo.state.players[0]?.id);
      setShowScoreLabels(false);
      setSelectedTerritoryId(undefined);
      setScenario(kind);
      setSeed(chosenSeed);
      setError(null);
    } catch (caught) {
      setError(formatDomainError(caught));
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
    if (!multiplayerConnected) return;
    try {
      await postMultiplayer(`/api/rooms/${encodeURIComponent(multiplayer.roomId)}/start`, {
        sessionToken: multiplayer.sessionToken,
        playerOrder: lobbyOrder,
        firstMapDrawerPlayerId: firstMultiplayerDrawerId,
        map: lobbyMap,
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const updateMultiplayerMap = async () => {
    if (multiplayer === null || multiplayerRoom === undefined ||
        !Number.isSafeInteger(lobbyMap.width) || lobbyMap.width <= 0 ||
        !Number.isSafeInteger(lobbyMap.height) || lobbyMap.height <= 0) {
      setError("Breite und Höhe müssen positive ganze Zahlen sein.");
      return;
    }
    if (!multiplayerConnected) return;
    try {
      await postMultiplayer(`/api/rooms/${encodeURIComponent(multiplayer.roomId)}/map`, {
        sessionToken: multiplayer.sessionToken, map: lobbyMap,
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
      setPrivacyPlayerId(firstPlayerId);
      setFactionVisible(false);
      setShowNewGameConfig(false);
      setShowDebugScenarios(false);
      setError(null);
    } catch (caught) {
      setError(formatDomainError(caught));
    }
  };
  const dispatch = (action: GameAction) => {
    if (!state || controller.current === null) return;
    if (multiplayer !== null && remoteConnectionStatus !== "CONNECTED") {
      setError("Die Verbindung wird wiederhergestellt. Aktionen sind vorübergehend gesperrt.");
      return;
    }
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
      setError(formatDomainError(caught));
    });
  };
  const beginRound = () => {
    dispatch({ type: GameActionType.StartRound });
  };
  const openHelp = (topic?: RuleHelpId) => {
    setHelpTopic(topic);
    setHelpOpen(true);
  };
  const dismissTutorialHint = (step: TutorialStep) => setTutorialProgress((current) => markTutorialSeen(current, step));
  const completeIntroduction = () => {
    setTutorialProgress((current) => markIntroductionSeen(current));
    setShowIntroduction(false);
  };
  const replayIntroduction = () => {
    setHelpOpen(false);
    setShowIntroduction(true);
  };
  const resetTutorial = () => {
    setTutorialProgress(resetTutorialProgress());
    setHelpOpen(false);
    setShowIntroduction(true);
  };
  const reset = () => {
    if (scenario && window.confirm("Aktuelles Demo-Spiel wirklich zurücksetzen?")) loadScenario(scenario, seed);
  };
  const name = (id: string) => state ? playerName(state, id) : id;
  const toggleTerritorySelection = (territoryId: string) => {
    setSelectedTerritoryId((current) => current === territoryId ? undefined : territoryId);
  };
  const highlightedIds = state === null ? [] : [
    ...(state.phase === GamePhase.ActivationPhase ? getAvailableActivationTerritoryIds(state) : []),
    ...(state.auction ? [state.auction.territoryId] : []),
  ];
  const split = state?.pendingSplit;
  const editorBase = state ? getMapEditor(state) : undefined;
  const editor = state ? getMapEditor(state, mapDraft && mapDraft.key === editorBase?.key ? mapDraft.keys : undefined) : undefined;
  const toggleMapCell = (cell: GridCell) => {
    if (!multiplayerConnected) return;
    if (!editor) return;
    const pendingWar = state?.pendingWar;
    const winningPlayerId = pendingWar?.combat === undefined ? undefined
      : pendingWar.combat.winnerTerritoryId === pendingWar.attackerTerritoryId
        ? pendingWar.attackerPlayerId : pendingWar.defenderPlayerId;
    const permittedPlayerId = pendingWar?.stage === "AWAITING_DIAMOND_CORRECTION"
      ? pendingWar.borderMark?.playerId : winningPlayerId ?? state?.pendingDiamondBorderChanges[0]?.playerId;
    if (multiplayer !== null && multiplayer.playerId !== permittedPlayerId) return;
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
  const multiplayerConnected = multiplayer === null || remoteConnectionStatus === "CONNECTED";
  const setupCanEdit = multiplayerConnected && (multiplayer === null || mapCreation?.activePlayerId === multiplayer.playerId);
  const setupDraftEdges = mergeDraftEdges([...setupDraft.strokes, ...(setupDraft.activeStroke === undefined ? [] : [setupDraft.activeStroke])]);
  const setupPreviewRegions = (() => {
    if (!state?.map || !mapCreation) return undefined;
    try {
      const keys = normalizeSetupBorderEdges(state.map, setupDraftEdges);
      const previewKeys = new Set(mapCreation.borders.edgeKeys);
      for (const key of keys) {
        if (setupDraft.mode === "CORRECTION" && previewKeys.has(key)) previewKeys.delete(key);
        else previewKeys.add(key);
      }
      return deriveSetupRegions(state.map, { edgeKeys: [...previewKeys].sort() });
    } catch {
      return undefined;
    }
  })();
  const setupEditor = mapCreation && state?.map ? {
    mode: setupPoiType[mapCreation.stage] ? "POI" as const : setupDraft.mode,
    selectable: setupSelectable,
    draftEdges: setupDraftEdges,
    previewRegions: setupPreviewRegions,
    editable: setupCanEdit,
  } : undefined;
  const selectSetupCell = (cell: GridCell) => {
    if (!state || !mapCreation) return;
    const poiType = setupPoiType[mapCreation.stage];
    if (poiType !== undefined) {
      if (!setupCanEdit) return;
      dispatch({ type: GameActionType.PlaceSetupPointOfInterest, playerId: mapCreation.activePlayerId, poiType, position: cell });
    }
  };
  const previewSetupStroke = (edges: readonly SetupBorderEdge[]) => {
    if (!setupCanEdit) return;
    setSetupDraft((current) => ({ ...current, activeStroke: edges }));
  };
  const commitSetupStroke = (edges: readonly SetupBorderEdge[]) => {
    if (!setupCanEdit || edges.length === 0) return;
    setSetupDraft((current) => ({ ...current, activeStroke: undefined, strokes: [...current.strokes, edges] }));
  };
  const eraseSetupStroke = (edges: readonly SetupBorderEdge[]) => {
    if (!setupCanEdit || edges.length === 0) return;
    const removed = new Set(edges.map((edge) => toSetupBorderEdgeKey(edge.from, edge.to)));
    setSetupDraft((current) => ({ ...current, activeStroke: undefined,
      strokes: current.strokes.map((stroke) => stroke.filter((edge) => !removed.has(toSetupBorderEdgeKey(edge.from, edge.to))))
        .filter((stroke) => stroke.length > 0) }));
  };
  const setupValidationIssues = state?.phase === GamePhase.MapCreation ? getSetupMapValidationIssues(state) : [];
  const initialSplitCells = split && state?.map
    ? getTerritoryCells(state.map, split.originalTerritoryId) : [];
  const currentSplitDraft: SplitDraft | undefined = split ? splitDraft?.splitId === split.id
    ? splitDraft : {
      splitId: split.id,
      partAKeys: initialSplitCells.slice(0, Math.floor(initialSplitCells.length / 2)).map((cell) => `${cell.x},${cell.y}`),
      originalCardPart: "A",
    } : undefined;
  const currentPartChoice = (() => {
    if (split?.stage === "AWAITING_CHOICE" && split.proposal) {
      const key = `auction:${split.id}`;
      return {
        key,
        territoryId: split.originalTerritoryId,
        partAKeys: split.proposal.partACells.map((cell) => `${cell.x},${cell.y}`),
        selectedPart: partChoiceDraft?.key === key ? partChoiceDraft.part : undefined,
        canChoose: multiplayer === null || multiplayer.playerId === split.firstChooserPlayerId,
      };
    }
    const war = state?.pendingWar;
    if (war?.stage === "AWAITING_CUT_CHOICE" && war.proposal && war.combat?.loserTerritoryId) {
      const key = `war:${war.id}`;
      return {
        key,
        territoryId: war.combat.loserTerritoryId,
        partAKeys: war.proposal.partACells.map((cell) => `${cell.x},${cell.y}`),
        selectedPart: partChoiceDraft?.key === key ? partChoiceDraft.part : undefined,
        canChoose: multiplayer === null || multiplayer.playerId === (war.combat.winnerTerritoryId === war.attackerTerritoryId ? war.defenderPlayerId : war.attackerPlayerId),
      };
    }
    return undefined;
  })();
  const toggleSplitCell = (cell: GridCell) => {
    if (!multiplayerConnected) return;
    if (!currentSplitDraft || split?.stage === "AWAITING_CHOICE") return;
    if (multiplayer !== null && multiplayer.playerId !== split?.dividerPlayerId) return;
    const key = `${cell.x},${cell.y}`;
    if (!initialSplitCells.some((item) => item.x === cell.x && item.y === cell.y)) return;
    const partAKeys = currentSplitDraft.partAKeys.includes(key)
      ? currentSplitDraft.partAKeys.filter((item) => item !== key)
      : [...currentSplitDraft.partAKeys, key];
    setSplitDraft({ ...currentSplitDraft, partAKeys });
  };
  const setOriginalCardPart = (part: "A" | "B") => {
    if (multiplayerConnected && currentSplitDraft) setSplitDraft({ ...currentSplitDraft, originalCardPart: part });
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
  const invitedRoomId = inviteRoomCode();
  const savedSessionForInvite = invitedRoomId === undefined ? undefined : savedMultiplayerSessions[invitedRoomId];
  const resumeSession = savedSessionForInvite ?? lastStoredMultiplayerSession(savedMultiplayerSessions);
  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setError(null);
    } catch {
      setError("Kopieren ist in diesem Browser nicht verfügbar.");
    }
  };
  const inviteLink = multiplayerRoom === undefined ? undefined : (() => {
    const url = new URL(window.location.href);
    url.search = `?room=${encodeURIComponent(multiplayerRoom.roomId)}`;
    return url.toString();
  })();

  return <div className="app-shell">
    {!state ? <main className="welcome-screen">
      <span className="eyebrow">{showMultiplayer ? "Mehrspieler" : showNewGameConfig ? "Lokales Testspiel" : "Willkommen"}</span>
      <h1>Vedras Reiche</h1>
      <p>{showMultiplayer ? "Der Spielserver verwaltet die Partie. Dein Browser zeigt nur deine eigene Spielansicht." : "Erschafft gemeinsam eine Karte, ersteigert Gebiete und erreicht die höchste Wertung."}</p>
      {!showNewGameConfig && !showDebugScenarios && !showMultiplayer && <div className="button-row welcome-actions">
        <button type="button" className="primary-button" onClick={() => setShowMultiplayer(true)}>Mehrspieler</button>
        <button type="button" className="secondary-button" onClick={() => setShowNewGameConfig(true)}>Lokales Testspiel</button>
        <button type="button" className="secondary-button" onClick={() => setShowIntroduction(true)}>Spiel erklären</button>
        <button type="button" className="text-button" onClick={() => setShowDebugScenarios(true)}>Debug-Szenarien</button>
      </div>}
      {showMultiplayer && <section className="new-game-config panel multiplayer-panel">
        <div className="panel-heading"><div><span className="section-kicker">Mehrspieler</span><h2>{multiplayerRoom ? `Raum ${multiplayerRoom.roomId}` : "Gemeinsame Partie"}</h2></div>
          {!multiplayer && <button type="button" className="text-button" onClick={() => setShowMultiplayer(false)}>Schließen</button>}</div>
        {multiplayerRoom === undefined ? <div className="config-stack">
          <Field label="Name"><input value={multiplayerName} maxLength={80} onChange={(event) => setMultiplayerName(event.target.value)} /></Field>
          <div className="button-row"><button type="button" className="primary-button" onClick={() => void createMultiplayerRoom()}>Neues Spiel erstellen</button></div>
          <div className="join-room-row"><Field label="Raumcode"><input value={joinRoomCode} maxLength={8} placeholder="ABC123" onChange={(event) => setJoinRoomCode(event.target.value.toUpperCase())} /></Field>
            <button type="button" className="secondary-button" onClick={() => void joinMultiplayerRoom()}>Raum beitreten</button></div>
          {resumeSession && <div className="lobby-resume-card"><strong>Letzte Partie: {resumeSession.roomId}</strong>
            <div className="button-row"><button type="button" className="secondary-button" onClick={() => void connectMultiplayer(resumeSession)}>Partie{resumeSession.playerName ? ` als ${resumeSession.playerName}` : ""} fortsetzen</button>
              <button type="button" className="text-button" onClick={() => forgetSavedMultiplayerSession(resumeSession.roomId)}>Vergessen</button></div>
            <small>Vergessen löscht nur diese lokale Spielersitzung.</small></div>}
          {multiplayer && remoteConnectionStatus !== "CONNECTED" && <p className="muted">{remoteConnectionStatus === "RECONNECTING" ? "Verbindung wird wiederhergestellt …" : "Verbindung wird hergestellt …"}</p>}
        </div> : <div className="config-stack">
          <div className="invite-panel"><strong>Mitspieler einladen</strong><p className="room-code">Raum: <strong>{multiplayerRoom.roomId}</strong></p>
            <div className="button-row"><button type="button" className="secondary-button" onClick={() => void copyToClipboard(multiplayerRoom.roomId)}>Code kopieren</button>
              {inviteLink && <button type="button" className="secondary-button" onClick={() => void copyToClipboard(inviteLink)}>Einladungslink kopieren</button>}</div></div>
          <div className="lobby-player-list">{lobbyOrder.map((playerId, index) => {
            const player = multiplayerRoom.players.find((item) => item.playerId === playerId);
            if (player === undefined) return null;
            const host = multiplayerRoom.hostPlayerId === multiplayer?.playerId;
            return <div key={playerId} className="lobby-player"><span>{index + 1}. {player.name} {playerId === multiplayerRoom.hostPlayerId ? "· Host" : ""} · {player.connected ? "verbunden" : "getrennt"}</span>
              {host && <span className="button-row"><button type="button" className="secondary-button" disabled={!multiplayerConnected || index === 0} onClick={() => moveLobbyPlayer(playerId, -1)}>↑</button><button type="button" className="secondary-button" disabled={!multiplayerConnected || index === lobbyOrder.length - 1} onClick={() => moveLobbyPlayer(playerId, 1)}>↓</button></span>}
            </div>;
          })}</div>
          {multiplayerRoom.hostPlayerId === multiplayer?.playerId ? <>
            <div className="number-fields">
              <Field label="Kartenbreite"><input type="number" min="1" step="1" value={lobbyMap.width}
                disabled={!multiplayerConnected} onChange={(event) => setLobbyMap((current) => ({ ...current, width: Number(event.target.value) }))} onBlur={() => void updateMultiplayerMap()} /></Field>
              <Field label="Kartenhöhe"><input type="number" min="1" step="1" value={lobbyMap.height}
                disabled={!multiplayerConnected} onChange={(event) => setLobbyMap((current) => ({ ...current, height: Number(event.target.value) }))} onBlur={() => void updateMultiplayerMap()} /></Field>
            </div>
            <small>Aktuelle Karte: {lobbyMap.width} × {lobbyMap.height} · Mindestgebiet: {Number.isSafeInteger(lobbyMap.width) && Number.isSafeInteger(lobbyMap.height) && lobbyMap.width > 0 && lobbyMap.height > 0 ? getMinimumTerritoryArea(lobbyMap) : "—"}</small>
            <Field label="Erster Kartenzeichner"><select value={firstMultiplayerDrawerId ?? ""} disabled={!multiplayerConnected} onChange={(event) => setFirstMultiplayerDrawerId(event.target.value)}>{lobbyOrder.map((playerId) => {
              const player = multiplayerRoom.players.find((item) => item.playerId === playerId);
              return player ? <option key={playerId} value={playerId}>{player.name}</option> : null;
            })}</select></Field>
            <button type="button" className="primary-button" disabled={!multiplayerConnected || multiplayerRoom.players.length < 2 || firstMultiplayerDrawerId === undefined} onClick={() => void startMultiplayerRoom()}>Spiel starten</button>
          </> : <p className="muted">Der Host legt Reihenfolge, Kartengröße und ersten Kartenzeichner fest. Aktuelle Karte: {multiplayerRoom.map.width} × {multiplayerRoom.map.height}.</p>}
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
            <div className="digital-profile" aria-label="Digitales Regelprofil"><strong>Digitales Spielfeld</strong><span>{DIGITAL_BOARD_WIDTH} × {DIGITAL_BOARD_HEIGHT} Kästchen</span><small>Mindestgebiet: {getMinimumTerritoryArea(DIGITAL_MAP_CONFIG)} Kästchen</small></div>
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
      <GameHeader state={state} playerName={name} mode={multiplayer ? "MULTIPLAYER" : "LOCAL"}
        viewerPlayerId={multiplayer?.playerId ?? privacyPlayerId} onOpenHelp={() => openHelp()} />
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
          </> : <p className="muted">{multiplayer ? "Der Server hält den gemeinsamen Spielstand aktuell." : "Kartenbau und Spielablauf verwenden den echten Game Core."}</p>}
          {multiplayer && <p className={`connection-status ${remoteConnectionStatus.toLowerCase()}`}>
            {remoteConnectionStatus === "CONNECTED" ? "● Verbunden" : remoteConnectionStatus === "RECONNECTING" ? "◌ Verbindung wird wiederhergestellt …" :
              remoteConnectionStatus === "INVALID_SESSION" ? "● Lokale Sitzung ungültig" : remoteConnectionStatus === "ROOM_NOT_FOUND" ? "● Raum nicht gefunden" :
                remoteConnectionStatus === "SESSION_REPLACED" ? "● Sitzung in anderem Fenster geöffnet" : "◌ Verbindung wird hergestellt …"}
          </p>}
          {state.phase === GamePhase.Finished && <label className="debug-toggle"><input type="checkbox" checked={showScoreLabels}
            onChange={(event) => setShowScoreLabels(event.target.checked)} /> Wertungsansicht auf der Karte</label>}
        </section>
        {error && <div role="alert" className="error-banner">Aktion nicht möglich: <strong>{error}</strong></div>}
        {multiplayer && remoteConnectionStatus !== "CONNECTED" && <div role="status" className="connection-banner">
          <strong>{remoteConnectionStatus === "RECONNECTING" ? "Verbindung verloren" : remoteConnectionStatus === "INVALID_SESSION" ? "Diese lokale Spielersitzung ist nicht mehr gültig." :
            remoteConnectionStatus === "ROOM_NOT_FOUND" ? "Dieser Raum ist auf dem Server nicht mehr vorhanden." : remoteConnectionStatus === "SESSION_REPLACED" ? "Diese Spielersitzung wurde in einem anderen Fenster geöffnet." : "Verbindung wird hergestellt …"}</strong>
          {remoteConnectionStatus === "RECONNECTING" && <span>Aktionen bleiben gesperrt, bis der Server den aktuellen Stand bestätigt hat.</span>}
          {(remoteConnectionStatus === "INVALID_SESSION" || remoteConnectionStatus === "ROOM_NOT_FOUND" || remoteConnectionStatus === "SESSION_REPLACED") && <span className="button-row"><button type="button" className="secondary-button" onClick={returnToMultiplayerStart}>Zur Mehrspieler-Startseite</button><button type="button" className="text-button" onClick={() => multiplayer && forgetSavedMultiplayerSession(multiplayer.roomId)}>Lokale Sitzung vergessen</button></span>}
        </div>}
        <div className="main-grid">
          <div className="board-column">
            <TerritoryBoard state={state} selectedId={selectedTerritoryId}
              onSelect={toggleTerritorySelection} onClearSelection={() => setSelectedTerritoryId(undefined)} highlightedIds={highlightedIds}
              viewerPlayerId={multiplayer?.playerId ?? privacyPlayerId} focusTerritoryId={state.pendingSplit?.originalTerritoryId ?? state.pendingWar?.attackerTerritoryId}
              partChoice={currentPartChoice === undefined ? undefined : { ...currentPartChoice, onChoose: (part) => setPartChoiceDraft({ key: currentPartChoice.key, part }) }} playerName={name}
              splitDraft={currentSplitDraft} onToggleSplitCell={toggleSplitCell}
              editor={editor} onToggleMapCell={toggleMapCell} realmHighlights={realmHighlights}
              scoreHundredthsByTerritoryId={scoreHundredthsByTerritoryId} showScoreLabels={showScoreLabels}
              setupEditor={setupEditor} onSetupSelectCell={selectSetupCell}
              onSetupStrokePreview={previewSetupStroke} onSetupStrokeCommit={commitSetupStroke} onSetupStrokeErase={eraseSetupStroke} />
          </div>
          <div className="sidebar-column">
            <FirstGameHint state={state} viewerPlayerId={multiplayer?.playerId ?? privacyPlayerId} progress={tutorialProgress}
              onDismiss={dismissTutorialHint} onOpenHelp={openHelp} />
            <ActionPanel><fieldset className="action-lock" disabled={!multiplayerConnected}><PhaseControls state={state} actionTerritoryId={actionTerritoryId}
                onSelectActionTerritory={setActionTerritoryId} onAction={dispatch} onStartRound={beginRound}
                splitDraft={currentSplitDraft} onToggleSplitCell={toggleSplitCell}
                onSetOriginalCardPart={setOriginalCardPart} editor={editor} playerName={name}
                setupDraft={setupDraft} onSetSetupDraft={setSetupDraft} setupValidationIssues={setupValidationIssues} setupCanEdit={setupCanEdit}
                privacyPlayerId={privacyPlayerId} viewerPlayerId={multiplayer?.playerId} factionVisible={factionVisible}
                onSetPrivacyPlayerId={setPrivacyPlayerId} onSetFactionVisible={setFactionVisible}
                selectedPart={currentPartChoice?.selectedPart} onSelectPart={(part) => currentPartChoice && setPartChoiceDraft({ key: currentPartChoice.key, part })} /></fieldset>
              <RecentWarResult state={state} /></ActionPanel>
            <SecretFactionPanel state={state} playerId={multiplayer?.playerId ?? privacyPlayerId} visible={factionVisible}
              onVisibleChange={setFactionVisible} localPassAndPlay={!multiplayer} onPlayerChange={setPrivacyPlayerId} />
            <PlayerPanel state={state} playerName={name} viewerPlayerId={multiplayer?.playerId ?? privacyPlayerId} />
            {selectedTerritoryId && <TerritoryDetails state={state} territoryId={selectedTerritoryId} playerName={name} />}
            <EventLog events={state.events} playerName={name} />
          </div>
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
      <HelpDrawer state={state} viewerPlayerId={multiplayer?.playerId ?? privacyPlayerId} open={helpOpen} initialTopic={helpTopic}
        onClose={() => setHelpOpen(false)} onReplayIntroduction={replayIntroduction} onResetTutorial={resetTutorial} />
    </>}
    <IntroductionTour open={showIntroduction} onComplete={completeIntroduction} />
  </div>;
}
