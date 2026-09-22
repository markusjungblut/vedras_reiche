import {
  areCellsOrthogonallyConnected, GameActionType, getAvailableWarSpades,
  getCellsWithinBorderDepth, getMaximumLegalBorderAdvance, getMinimumTerritoryArea, getSharedBorder, getTerritoryCells,
  validateBorderAdvance, validateTerritorySplit,
  type GameAction, type GameState, type GridCell,
} from "@vedras/game-core";

export interface MapEditor {
  readonly key: string;
  readonly mode: "CUT" | "CLAIM";
  readonly targetId: string;
  readonly selectable: readonly GridCell[];
  readonly selected: readonly GridCell[];
}

export function getMapEditor(state: GameState, selectedKeys?: readonly string[]): MapEditor | undefined {
  const map = state.map;
  if (!map) return undefined;
  const war = state.pendingWar;
  if (war?.stage === "AWAITING_BORDER_ADVANCE" && war.combat?.loserTerritoryId &&
      war.maximumDepth && war.combat.winnerTerritoryId) {
    const selectable = getCellsWithinBorderDepth(map, war.combat.loserTerritoryId, war.originalSharedBorder, war.maximumDepth);
    return {
      key: `${war.id}:${war.stage}`, mode: "CLAIM", targetId: war.combat.loserTerritoryId,
      selectable,
      selected: selectedKeys === undefined
        ? getMaximumLegalBorderAdvance(map, war.combat.winnerTerritoryId, war.combat.loserTerritoryId, war.originalSharedBorder, war.maximumDepth)
        : selectedKeys.map(parseKey),
    };
  }
  if (war?.stage === "AWAITING_CUT_DIVISION" && war.combat?.loserTerritoryId) {
    const cells = getTerritoryCells(map, war.combat.loserTerritoryId);
    return { key: `${war.id}:${war.stage}`, mode: "CUT", targetId: war.combat.loserTerritoryId,
      selectable: cells, selected: selectedKeys === undefined ? cells.slice(0, Math.floor(cells.length / 2)) : selectedKeys.map(parseKey) };
  }
  if (war?.stage === "AWAITING_CUT_CHOICE" && war.combat?.loserTerritoryId && war.proposal) {
    return { key: `${war.id}:${war.stage}`, mode: "CUT", targetId: war.combat.loserTerritoryId,
      selectable: [], selected: war.proposal.partACells };
  }
  if (war?.stage === "AWAITING_DIAMOND_CORRECTION" && war.cutTerritoryIds && war.borderMark) {
    const [first, second] = war.cutTerritoryIds;
    const recipient = state.territories.find((territory) => territory.id === first)?.ownerId === war.borderMark.playerId ? first : second;
    const donor = recipient === first ? second : first;
    const border = getSharedBorder(map, recipient, donor);
    const selectable = getCellsWithinBorderDepth(map, donor, border, 1);
    return { key: `${war.id}:${war.stage}`, mode: "CLAIM", targetId: donor, selectable,
      selected: selectedKeys === undefined ? getMaximumLegalBorderAdvance(map, recipient, donor, border, 1) : selectedKeys.map(parseKey) };
  }
  const effect = state.pendingDiamondBorderChanges[0];
  if (effect) {
    const border = getSharedBorder(map, effect.sourceTerritoryId, effect.neutralTerritoryId);
    const selectable = getCellsWithinBorderDepth(map, effect.neutralTerritoryId, border, 2);
    return { key: effect.id, mode: "CLAIM", targetId: effect.neutralTerritoryId, selectable,
      selected: selectedKeys === undefined ? getMaximumLegalBorderAdvance(map, effect.sourceTerritoryId, effect.neutralTerritoryId, border, 2) : selectedKeys.map(parseKey) };
  }
  return undefined;
}

function parseKey(key: string): GridCell {
  const [x, y] = key.split(",").map(Number);
  return { x: x!, y: y! };
}

function Name({ state, id }: { state: GameState; id: string }) {
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

export function RecentWarResult({ state }: { state: GameState }) {
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

export function WarControls({ state, editor, onAction }: {
  state: GameState; editor?: MapEditor | undefined; onAction: (action: GameAction) => void;
}) {
  const war = state.pendingWar;
  const map = state.map;
  if (!war || !map) return null;
  const combat = war.combat;
  const winnerId = combat?.winnerTerritoryId;
  const loserId = combat?.loserTerritoryId;
  const winnerPlayerId = winnerId === war.attackerTerritoryId ? war.attackerPlayerId : war.defenderPlayerId;
  const loserPlayerId = winnerPlayerId === war.attackerPlayerId ? war.defenderPlayerId : war.attackerPlayerId;
  const validation = editor && editor.mode === "CLAIM" && winnerId && loserId && war.maximumDepth
    ? validateBorderAdvance(map, winnerId, loserId, war.originalSharedBorder, war.maximumDepth, editor.selected) : undefined;
  const splitValidation = editor?.mode === "CUT" && loserId ? validateTerritorySplit(map, loserId, editor.selected) : undefined;
  const correctionIds = war.cutTerritoryIds;
  const correctionRecipient = correctionIds && war.borderMark
    ? state.territories.find((territory) => territory.id === correctionIds[0])?.ownerId === war.borderMark.playerId
      ? correctionIds[0] : correctionIds[1] : undefined;
  const correctionDonor = correctionIds && correctionRecipient
    ? correctionIds.find((id) => id !== correctionRecipient) : undefined;
  const correctionValidation = editor && correctionRecipient && correctionDonor
    ? validateBorderAdvance(map, correctionRecipient, correctionDonor,
      getSharedBorder(map, correctionRecipient, correctionDonor), 1, editor.selected) : undefined;
  return <section className="control-section" aria-label="Krieg">
    <div className="section-kicker">Krieg · {STAGE_LABEL[war.stage]}</div>
    <h3>{war.attackerTerritoryId} gegen {war.defenderTerritoryId}</h3>
    <div className="war-sides">
      <p><strong>Angreifer</strong><br/><Name state={state} id={war.attackerPlayerId}/> · {war.attackerTerritoryId}<br/>Fläche {war.attackerArea}</p>
      <p><strong>Verteidiger</strong><br/><Name state={state} id={war.defenderPlayerId}/> · {war.defenderTerritoryId}<br/>Fläche {war.defenderArea} · Festungen {state.pointsOfInterest.filter((poi) => poi.type === "FORTRESS" && map.cells[`${poi.position.x},${poi.position.y}`] === war.defenderTerritoryId).length}</p>
    </div>
    {war.stage === "AWAITING_COMBAT_CHOICES" && [war.attackerPlayerId, war.defenderPlayerId].map((playerId) => {
      const locked = Object.hasOwn(war.spadeChoices, playerId);
      const opponentId = playerId === war.attackerPlayerId ? war.defenderTerritoryId : war.attackerTerritoryId;
      const options = getAvailableWarSpades(state, playerId, opponentId);
      return <div key={playerId} className="war-choice">
        <h4><Name state={state} id={playerId}/> · ♠ einsetzen?</h4>
        {locked ? <p>✓ Entscheidung bestätigt und bis zum Kampf verdeckt</p> : <div className="button-row">
          <button className="secondary-button" onClick={() => onAction({ type: GameActionType.SetWarSpadeChoice, warId: war.id, playerId, spadeActivationId: null })}>Keine</button>
          {options.map((option) => <button className="secondary-button" key={option.id} onClick={() => onAction({ type: GameActionType.SetWarSpadeChoice,
            warId: war.id, playerId, spadeActivationId: option.id })}>♠ aus {option.sourceTerritoryId}: +{option.bonus}</button>)}
        </div>}
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
      {war.borderMark && <p>♦ Grenzmarkierung aktiv · Standard {war.maximumDepth! - (war.borderMark.playerId === winnerPlayerId ? 1 : -1)} → {war.maximumDepth}</p>}
      <p>Übernahme: {editor.selected.length} Kästchen · Gewinner: {getTerritoryCells(map, winnerId).length + editor.selected.length} · Verlierer: {getTerritoryCells(map, loserId).length - editor.selected.length} · Mindestfläche {getMinimumTerritoryArea(map)}</p>
      <p>{validation.valid ? "Zusammenhang und Mindestfläche ✓" : `Ungültig: ${validation.reason}`}</p>
      <button className="primary-button" disabled={!validation.valid} onClick={() => onAction({ type: GameActionType.ProposeBorderAdvance,
        warId: war.id, playerId: winnerPlayerId, claimedCells: editor.selected })}>Grenzgewinn bestätigen</button>
    </>}
    {war.stage === "AWAITING_CUT_DIVISION" && editor && splitValidation && <>
      <h4>Gewinner zieht die Grenze</h4>
      <p>Teil A {editor.selected.length} · Teil B {splitValidation.partBCells.length} · Mindestfläche {getMinimumTerritoryArea(map)}</p>
      <p>Zusammenhang A {areCellsOrthogonallyConnected(editor.selected) ? "✓" : "✗"} · B {areCellsOrthogonallyConnected(splitValidation.partBCells) ? "✓" : "✗"}</p>
      <p>Der Verlierer wählt zuerst. Sein Teil behält automatisch die ursprüngliche Karte.</p>
      <button className="primary-button" disabled={!splitValidation.valid} onClick={() => onAction({ type: GameActionType.ProposeWarCut,
        warId: war.id, playerId: winnerPlayerId, partACells: editor.selected })}>Teilung bestätigen</button>
    </>}
    {war.stage === "AWAITING_CUT_CHOICE" && war.proposal && <>
      <h4><Name state={state} id={loserPlayerId}/> wählt zuerst</h4>
      <p>Teil A {war.proposal.partACells.length} · Teil B {war.proposal.partBCells.length}. Der gewählte Teil behält die ursprüngliche Gebietskarte.</p>
      <div className="button-row">{(["A", "B"] as const).map((part) => <button key={part} className="primary-button" onClick={() => onAction({ type: GameActionType.ChooseWarCut,
        warId: war.id, playerId: loserPlayerId, chosenPart: part })}>Teil {part} behalten</button>)}</div>
    </>}
    {war.stage === "AWAITING_DIAMOND_CORRECTION" && war.borderMark && editor && <>
      <h4>♦ Korrektur für <Name state={state} id={war.borderMark.playerId}/></h4>
      <p>Bis zu ein Kästchen entlang der neuen Teilungsgrenze.</p>
      <p>Übernahme: {editor.selected.length} Kästchen</p>
      {correctionValidation && <p>{correctionValidation.valid ? "Zusammenhang und Mindestfläche ✓" : `Ungültig: ${correctionValidation.reason}`}</p>}
      <div className="button-row">
        <button className="primary-button" disabled={!correctionValidation?.valid} onClick={() => onAction({ type: GameActionType.ResolveDiamondCorrection,
          warId: war.id, playerId: war.borderMark!.playerId, claimedCells: editor.selected })}>Korrektur bestätigen</button>
        <button className="secondary-button" onClick={() => onAction({ type: GameActionType.ResolveDiamondCorrection,
          warId: war.id, playerId: war.borderMark!.playerId, claimedCells: [] })}>Überspringen</button>
      </div>
    </>}
  </section>;
}

export function NeutralDiamondControls({ state, editor, onAction }: {
  state: GameState; editor?: MapEditor | undefined; onAction: (action: GameAction) => void;
}) {
  const effect = state.pendingDiamondBorderChanges[0];
  if (!effect || !editor || !state.map) return null;
  const validation = validateBorderAdvance(state.map, effect.sourceTerritoryId, effect.neutralTerritoryId,
    getSharedBorder(state.map, effect.sourceTerritoryId, effect.neutralTerritoryId), 2, editor.selected);
  return <section className="control-section" aria-label="Neutrale ♦-Grenze">
    <div className="section-kicker">♦ Neutrale Grenze</div>
    <h3>{effect.sourceTerritoryId} zu {effect.neutralTerritoryId}</h3>
    <p>Klicke Zellen im markierten Korridor an. Bis zu 2 Kästchen Tiefe.</p>
    <p>Eigenes Gebiet: {getTerritoryCells(state.map, effect.sourceTerritoryId).length + editor.selected.length} · neutrales Gebiet: {getTerritoryCells(state.map, effect.neutralTerritoryId).length - editor.selected.length}</p>
    <p>{validation.valid ? "Zusammenhang und Mindestfläche ✓" : `Ungültig: ${validation.reason}`}</p>
    <div className="button-row">
      <button className="primary-button" disabled={!validation.valid} onClick={() => onAction({ type: GameActionType.ResolveNeutralDiamond,
        effectId: effect.id, playerId: effect.playerId, claimedCells: editor.selected })}>Grenze bestätigen</button>
      <button className="secondary-button" onClick={() => onAction({ type: GameActionType.ResolveNeutralDiamond,
        effectId: effect.id, playerId: effect.playerId, claimedCells: [] })}>Keine Grenzänderung</button>
    </div>
  </section>;
}
