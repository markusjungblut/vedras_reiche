import {
  areCellsOrthogonallyConnected, GameActionType, getAvailableWarSpades,
  getCellsWithinBorderDepth, getMaximumLegalBorderAdvance, getMinimumTerritoryArea, getSharedBorder, getTerritoryCells,
  getNeutralDiamondDepth, scaleGridDepth, validateBorderAdvance, validateTerritorySplit,
  type GameAction, type GridCell,
} from "@vedras/game-core";
import type { GameReadModel } from "../game-read-model";

export interface MapEditor {
  readonly key: string;
  readonly mode: "CUT" | "CLAIM";
  readonly targetId: string;
  readonly selectable: readonly GridCell[];
  readonly selected: readonly GridCell[];
  readonly annexedDisconnectedCells: readonly GridCell[];
}

export interface WarCutWorkflow {
  readonly stage: "DRAW_BOUNDARY" | "PREVIEW_BOUNDARY" | "FINE_TUNE_CELLS";
  readonly boundaryMessage: string;
  readonly canAdoptBoundary: boolean;
  readonly onAdoptBoundary: () => void;
  readonly onResetBoundary: () => void;
}

export function getMapEditor(state: GameReadModel, selectedKeys?: readonly string[]): MapEditor | undefined {
  const map = state.map;
  if (!map) return undefined;
  const claimEditor = (key: string, targetId: string, winnerId: string, border: ReturnType<typeof getSharedBorder>, maximumDepth: number): MapEditor => {
    const selectable = getCellsWithinBorderDepth(map, targetId, border, maximumDepth);
    const selected = selectedKeys === undefined
      ? getMaximumLegalBorderAdvance(map, winnerId, targetId, border, maximumDepth)
      : selectedKeys.map(parseKey);
    const validation = validateBorderAdvance(map, winnerId, targetId, border, maximumDepth, selected);
    return { key, mode: "CLAIM", targetId, selectable, selected,
      annexedDisconnectedCells: validation.annexedDisconnectedCells ?? [] };
  };
  const war = state.pendingWar;
  if (war?.stage === "AWAITING_BORDER_ADVANCE" && war.combat?.loserTerritoryId &&
      war.maximumDepth && war.combat.winnerTerritoryId) {
    return claimEditor(`${war.id}:${war.stage}`, war.combat.loserTerritoryId, war.combat.winnerTerritoryId,
      war.originalSharedBorder, war.maximumDepth);
  }
  if (war?.stage === "AWAITING_CUT_DIVISION" && war.combat?.loserTerritoryId) {
    const cells = getTerritoryCells(map, war.combat.loserTerritoryId);
    return { key: `${war.id}:${war.stage}`, mode: "CUT", targetId: war.combat.loserTerritoryId,
      selectable: cells, selected: selectedKeys === undefined ? [] : selectedKeys.map(parseKey), annexedDisconnectedCells: [] };
  }
  if (war?.stage === "AWAITING_CUT_CHOICE" && war.combat?.loserTerritoryId && war.proposal) {
    return { key: `${war.id}:${war.stage}`, mode: "CUT", targetId: war.combat.loserTerritoryId,
      selectable: [], selected: war.proposal.partACells, annexedDisconnectedCells: [] };
  }
  if (war?.stage === "AWAITING_DIAMOND_CORRECTION" && war.cutTerritoryIds && war.borderMark) {
    const [first, second] = war.cutTerritoryIds;
    const recipient = state.territories.find((territory) => territory.id === first)?.ownerId === war.borderMark.playerId ? first : second;
    const donor = recipient === first ? second : first;
    const border = getSharedBorder(map, recipient, donor);
    return claimEditor(`${war.id}:${war.stage}`, donor, recipient, border, scaleGridDepth(1, map));
  }
  const effect = state.pendingDiamondBorderChanges[0];
  if (effect) {
    const border = getSharedBorder(map, effect.sourceTerritoryId, effect.neutralTerritoryId);
    return claimEditor(effect.id, effect.neutralTerritoryId, effect.sourceTerritoryId, border, getNeutralDiamondDepth(map));
  }
  return undefined;
}

function parseKey(key: string): GridCell {
  const [x, y] = key.split(",").map(Number);
  return { x: x!, y: y! };
}

function Name({ state, id }: { state: GameReadModel; id: string }) {
  return <>{state.players.find((player) => player.id === id)?.name ?? id}</>;
}

const STAGE_LABEL = {
  AWAITING_COMBAT_CHOICES: "♠-Entscheidungen",
  AWAITING_BORDER_ADVANCE: "Grenze verschieben",
  AWAITING_CUT_DIVISION: "Gebiet teilen",
  AWAITING_CUT_CHOICE: "Gebietsteil wählen",
  AWAITING_DIAMOND_CORRECTION: "♦-Korrektur",
} as const;
const OUTCOME_LABEL = {
  TIE: "Gleichstand",
  BORDER_ADVANCE: "Normaler Grenzgewinn",
  STRONG_ADVANCE: "Starker Vorstoß",
  CONQUEST: "Vollständige Eroberung",
  CUT_AND_CHOOSE: "Durchbruch und Teilung",
} as const;

export function RecentWarResult({ state }: { state: GameReadModel }) {
  const latest = state.lastWarResult;
  if (!latest || state.pendingWar || latest.round !== state.round) return null;
  const { combat } = latest;
  const attackerName = state.players.find((player) => player.id === latest.attackerPlayerId)?.name ?? latest.attackerPlayerId;
  const defenderName = state.players.find((player) => player.id === latest.defenderPlayerId)?.name ?? latest.defenderPlayerId;
  const conquestOwner = combat.winnerTerritoryId === latest.attackerTerritoryId ? attackerName : defenderName;
  return <section className="control-section war-result" aria-label="Letztes Kampfergebnis">
    <div className="section-kicker">Letzter Krieg · {latest.attackerTerritoryId} gegen {latest.defenderTerritoryId}</div>
    <h3>{OUTCOME_LABEL[combat.outcome]}</h3>
    <p>{attackerName}: W6 {combat.attackerRoll} + ♠ {combat.attackerSpadeBonus} = {combat.attackerTotal}</p>
    <p>{defenderName}: W6 {combat.defenderRoll} + ♠ {combat.defenderSpadeBonus} + Festungen {combat.defenderFortressBonus} = {combat.defenderTotal}</p>
    <p>Differenz {combat.difference}</p>
    {combat.outcome === "CONQUEST" && <p><strong>{combat.loserTerritoryId} wurde vollständig von {conquestOwner} erobert.</strong> Die Gebietsgrenze und Karte bleiben bestehen.</p>}
  </section>;
}

export function WarControls({ state, editor, onAction, viewerPlayerId, selectedPart, onSelectPart, cutWorkflow }: {
  state: GameReadModel; editor?: MapEditor | undefined; onAction: (action: GameAction) => void;
  viewerPlayerId?: string | undefined;
  selectedPart?: "A" | "B" | undefined;
  onSelectPart?: ((part: "A" | "B") => void) | undefined;
  cutWorkflow?: WarCutWorkflow | undefined;
}) {
  const war = state.pendingWar;
  const map = state.map;
  if (!war || !map) return null;
  const combat = war.combat;
  const winnerId = combat?.winnerTerritoryId;
  const loserId = combat?.loserTerritoryId;
  const winnerPlayerId = winnerId === war.attackerTerritoryId ? war.attackerPlayerId : war.defenderPlayerId;
  const loserPlayerId = winnerPlayerId === war.attackerPlayerId ? war.defenderPlayerId : war.attackerPlayerId;
  const mayResolveWar = viewerPlayerId === undefined || viewerPlayerId === winnerPlayerId;
  const mayChooseWarCut = viewerPlayerId === undefined || viewerPlayerId === loserPlayerId;
  const mayCorrectDiamond = viewerPlayerId === undefined || viewerPlayerId === war.borderMark?.playerId;
  const validation = editor && editor.mode === "CLAIM" && winnerId && loserId && war.maximumDepth
    ? validateBorderAdvance(map, winnerId, loserId, war.originalSharedBorder, war.maximumDepth, editor.selected) : undefined;
  const splitValidation = editor?.mode === "CUT" && loserId ? validateTerritorySplit(map, loserId, editor.selected) : undefined;
  const correctionIds = war.cutTerritoryIds;
  const correctionRecipient = correctionIds && war.borderMark
    ? state.territories.find((territory) => territory.id === correctionIds[0])?.ownerId === war.borderMark.playerId
      ? correctionIds[0] : correctionIds[1] : undefined;
  const correctionDonor = correctionIds && correctionRecipient
    ? correctionIds.find((id) => id !== correctionRecipient) : undefined;
  const correctionDepth = scaleGridDepth(1, map);
  const unmarkedAdvanceDepth = combat?.outcome === "STRONG_ADVANCE" ? scaleGridDepth(4, map) : scaleGridDepth(2, map);
  const correctionValidation = editor && correctionRecipient && correctionDonor
    ? validateBorderAdvance(map, correctionRecipient, correctionDonor,
      getSharedBorder(map, correctionRecipient, correctionDonor), correctionDepth, editor.selected) : undefined;
  return <section className="control-section" aria-label="Krieg">
    <div className="section-kicker">Krieg · {STAGE_LABEL[war.stage]}</div>
    <h3>{war.attackerTerritoryId} gegen {war.defenderTerritoryId}</h3>
    <div className="war-sides">
      <p><strong>Angreifer</strong><br/><Name state={state} id={war.attackerPlayerId}/> · {war.attackerTerritoryId}<br/>Fläche {war.attackerArea}</p>
      <p><strong>Verteidiger</strong><br/><Name state={state} id={war.defenderPlayerId}/> · {war.defenderTerritoryId}<br/>Fläche {war.defenderArea} · Festungen {state.pointsOfInterest.filter((poi) => poi.type === "FORTRESS" && map.cells[`${poi.position.x},${poi.position.y}`] === war.defenderTerritoryId).length}</p>
    </div>
    {war.stage === "AWAITING_COMBAT_CHOICES" && [war.attackerPlayerId, war.defenderPlayerId]
      .filter((playerId) => viewerPlayerId === undefined || playerId === viewerPlayerId).flatMap((playerId) => {
      const locked = Object.hasOwn(war.spadeChoices, playerId);
      const opponentId = playerId === war.attackerPlayerId ? war.defenderTerritoryId : war.attackerTerritoryId;
      const options = getAvailableWarSpades(state, playerId, opponentId);
      if (locked || options.length === 0) return [];
      return <div key={playerId} className="war-choice">
        <h4>♠-Bonus verfügbar</h4>
        <p>{options.map((option) => `${option.sourceTerritoryId} kann für diesen Kampf +${option.bonus} geben.`).join(" ")}</p>
        <div className="button-row">
          <button className="secondary-button" onClick={() => onAction({ type: GameActionType.SetWarSpadeChoice, warId: war.id, playerId, spadeActivationId: null })}>Nicht einsetzen</button>
          {options.map((option) => <button className="secondary-button" key={option.id} onClick={() => onAction({ type: GameActionType.SetWarSpadeChoice,
            warId: war.id, playerId, spadeActivationId: option.id })}>♠ aus {option.sourceTerritoryId}: +{option.bonus}</button>)}
        </div>
      </div>;
    })}
    {combat && <div className="war-result">
      <h4>Kampfergebnis: {OUTCOME_LABEL[combat.outcome]}</h4>
      <p><Name state={state} id={war.attackerPlayerId}/>: W6 {combat.attackerRoll} + ♠ {combat.attackerSpadeBonus} = {combat.attackerTotal}</p>
      <p><Name state={state} id={war.defenderPlayerId}/>: W6 {combat.defenderRoll} + ♠ {combat.defenderSpadeBonus} + Festungen {combat.defenderFortressBonus} = {combat.defenderTotal}</p>
      <p>Differenz {combat.difference}</p>
    </div>}
    {war.stage === "AWAITING_BORDER_ADVANCE" && editor && validation && winnerId && loserId && <>
      <h4>Grenze verschieben · maximal {war.maximumDepth} Kästchen Tiefe</h4>
      {war.borderMark && <p>♦ Grenzmarkierung aktiv · ohne Markierung {unmarkedAdvanceDepth} → {war.maximumDepth}</p>}
      <p>Direkter Grenzgewinn: {editor.selected.length} Kästchen · Abgeschnittenes Land: {validation.annexedDisconnectedCells?.length ?? 0} Kästchen · Gesamtübernahme: {editor.selected.length + (validation.annexedDisconnectedCells?.length ?? 0)} Kästchen</p>
      <p>Gewinner: {getTerritoryCells(map, winnerId).length + editor.selected.length + (validation.annexedDisconnectedCells?.length ?? 0)} · Verlierer: {getTerritoryCells(map, loserId).length - editor.selected.length - (validation.annexedDisconnectedCells?.length ?? 0)} · Mindestfläche {getMinimumTerritoryArea(map)}</p>
      <p>{validation.valid ? "Zusammenhang und Mindestfläche ✓" : validation.reason === "AMBIGUOUS_RETAINED_COMPONENT" ? "Diese Grenzverschiebung würde das verbleibende Gebiet in mehrere gleich große Hauptteile trennen. Ändere die Auswahl." : `Ungültig: ${validation.reason}`}</p>
      {!mayResolveWar && <p className="winner-message">Warte auf den Grenzentscheid von <Name state={state} id={winnerPlayerId}/>.</p>}
      <button className="primary-button" disabled={!mayResolveWar || !validation.valid} onClick={() => onAction({ type: GameActionType.ProposeBorderAdvance,
        warId: war.id, playerId: winnerPlayerId, claimedCells: editor.selected })}>Grenzgewinn bestätigen</button>
    </>}
    {war.stage === "AWAITING_CUT_DIVISION" && editor && splitValidation && <>
      <h4>Gebiet teilen</h4>
      <p>Ziehe eine Grenze durch {loserId}, sodass zwei legale Teile entstehen. Der Verlierer wählt anschließend den Teil mit der ursprünglichen Karte.</p>
      {!mayResolveWar && <p className="winner-message">Warte darauf, dass <Name state={state} id={winnerPlayerId}/> die Grenze zeichnet.</p>}
      {cutWorkflow?.stage === "DRAW_BOUNDARY" && <p className="winner-message">{cutWorkflow.boundaryMessage}</p>}
      {cutWorkflow?.stage === "PREVIEW_BOUNDARY" && <>
        <p>{cutWorkflow.boundaryMessage}</p>
        <div className="button-row">
          <button className="primary-button" disabled={!mayResolveWar || !cutWorkflow.canAdoptBoundary} onClick={cutWorkflow.onAdoptBoundary}>Grenze übernehmen</button>
          <button className="secondary-button" disabled={!mayResolveWar} onClick={cutWorkflow.onResetBoundary}>Grenze neu zeichnen</button>
        </div>
      </>}
      {cutWorkflow?.stage === "FINE_TUNE_CELLS" && <>
        <p>Feinjustierung: Klicke einzelne Kästchen an, wenn du die Aufteilung noch korrigieren möchtest.</p>
        <p>Teil A {editor.selected.length} · Teil B {splitValidation.partBCells.length} · Mindestfläche {getMinimumTerritoryArea(map)}</p>
        <p>Zusammenhang A {areCellsOrthogonallyConnected(editor.selected) ? "✓" : "✗"} · B {areCellsOrthogonallyConnected(splitValidation.partBCells) ? "✓" : "✗"}</p>
        <p>{splitValidation.valid ? "Beide Teile sind zusammenhängend und regelkonform." : `Noch nicht gültig: ${splitValidation.reason ?? "Mindestgröße oder Zusammenhang fehlt"}.`}</p>
        <div className="button-row">
          <button className="primary-button" disabled={!mayResolveWar || !splitValidation.valid} onClick={() => onAction({ type: GameActionType.ProposeWarCut,
            warId: war.id, playerId: winnerPlayerId, partACells: editor.selected })}>Teilung bestätigen</button>
          <button className="secondary-button" disabled={!mayResolveWar} onClick={cutWorkflow.onResetBoundary}>Grenze neu zeichnen</button>
        </div>
      </>}
    </>}
    {war.stage === "AWAITING_CUT_CHOICE" && war.proposal && <>
      <h4><Name state={state} id={loserPlayerId}/> wählt den Teil, den er behält</h4>
      <p>Teil A {war.proposal.partACells.length} · Teil B {war.proposal.partBCells.length}. Beide Teile sind auf der Karte markiert.</p>
      {!mayChooseWarCut && <p className="winner-message">Warte auf die Auswahl von <Name state={state} id={loserPlayerId}/>.</p>}
      {mayChooseWarCut && <div className="button-row">{(["A", "B"] as const).map((part) => <button key={part} className={selectedPart === part ? "selected-button" : "secondary-button"}
        onClick={() => onSelectPart?.(part)}>Teil {part} behalten</button>)}</div>}
      {mayChooseWarCut && selectedPart && <><p className="winner-message"><Name state={state} id={loserPlayerId}/> behält Teil {selectedPart}. <Name state={state} id={winnerPlayerId}/> erhält Teil {selectedPart === "A" ? "B" : "A"}.</p>
        <button className="primary-button" onClick={() => onAction({ type: GameActionType.ChooseWarCut,
          warId: war.id, playerId: loserPlayerId, chosenPart: selectedPart })}>Auswahl bestätigen</button></>}
    </>}
    {war.stage === "AWAITING_DIAMOND_CORRECTION" && war.borderMark && editor && <>
      <h4>♦ Korrektur für <Name state={state} id={war.borderMark.playerId}/></h4>
      <p>Bis zu {correctionDepth} Kästchen entlang der neuen Teilungsgrenze.</p>
      <p>Direkte Korrektur: {editor.selected.length} Kästchen · Abgeschnittenes Land: {correctionValidation?.annexedDisconnectedCells?.length ?? 0} Kästchen · Gesamtübernahme: {editor.selected.length + (correctionValidation?.annexedDisconnectedCells?.length ?? 0)} Kästchen</p>
      {correctionValidation && <p>{correctionValidation.valid ? "Zusammenhang und Mindestfläche ✓" : correctionValidation.reason === "AMBIGUOUS_RETAINED_COMPONENT" ? "Die Auswahl erzeugt mehrere gleich große Hauptteile. Ändere sie." : `Ungültig: ${correctionValidation.reason}`}</p>}
      <div className="button-row">
        <button className="primary-button" disabled={!mayCorrectDiamond || !correctionValidation?.valid} onClick={() => onAction({ type: GameActionType.ResolveDiamondCorrection,
          warId: war.id, playerId: war.borderMark!.playerId, claimedCells: editor.selected })}>Korrektur bestätigen</button>
        <button className="secondary-button" disabled={!mayCorrectDiamond} onClick={() => onAction({ type: GameActionType.ResolveDiamondCorrection,
          warId: war.id, playerId: war.borderMark!.playerId, claimedCells: [] })}>Überspringen</button>
      </div>
    </>}
  </section>;
}

export function NeutralDiamondControls({ state, editor, onAction }: {
  state: GameReadModel; editor?: MapEditor | undefined; onAction: (action: GameAction) => void;
}) {
  const effect = state.pendingDiamondBorderChanges[0];
  if (!effect || !editor || !state.map) return null;
  const maximumDepth = getNeutralDiamondDepth(state.map);
  const validation = validateBorderAdvance(state.map, effect.sourceTerritoryId, effect.neutralTerritoryId,
    getSharedBorder(state.map, effect.sourceTerritoryId, effect.neutralTerritoryId), maximumDepth, editor.selected);
  return <section className="control-section" aria-label="Neutrale ♦-Grenze">
    <div className="section-kicker">♦ Neutrale Grenze</div>
    <h3>{effect.sourceTerritoryId} zu {effect.neutralTerritoryId}</h3>
    <p>Bis zu {maximumDepth} Kästchen Tiefe. Die maximal legale Vorauswahl ist bereits auf der Karte markiert. Klicke Zellen im Korridor an, um sie anzupassen.</p>
    <p>Direkter Grenzgewinn: {editor.selected.length} Kästchen · Abgeschnittenes Land: {validation.annexedDisconnectedCells?.length ?? 0} Kästchen · Gesamtübernahme: {editor.selected.length + (validation.annexedDisconnectedCells?.length ?? 0)} Kästchen</p>
    {editor.selected.length === 0 && <p className="winner-message">Du übernimmst keine Fläche.</p>}
    <p>Eigenes Gebiet: {getTerritoryCells(state.map, effect.sourceTerritoryId).length + editor.selected.length + (validation.annexedDisconnectedCells?.length ?? 0)} · neutrales Gebiet: {getTerritoryCells(state.map, effect.neutralTerritoryId).length - editor.selected.length - (validation.annexedDisconnectedCells?.length ?? 0)}</p>
    <p>{validation.valid ? "Zusammenhang und Mindestfläche ✓" : validation.reason === "AMBIGUOUS_RETAINED_COMPONENT" ? "Diese Grenzverschiebung würde das verbleibende Gebiet in mehrere gleich große Hauptteile trennen. Ändere die Auswahl." : `Ungültig: ${validation.reason}`}</p>
    <div className="button-row">
      <button className="primary-button" disabled={!validation.valid} onClick={() => onAction({ type: GameActionType.ResolveNeutralDiamond,
        effectId: effect.id, playerId: effect.playerId, claimedCells: editor.selected })}>Grenze bestätigen</button>
      <button className="secondary-button" onClick={() => onAction({ type: GameActionType.ResolveNeutralDiamond,
        effectId: effect.id, playerId: effect.playerId, claimedCells: [] })}>Keine Grenzänderung</button>
    </div>
  </section>;
}
