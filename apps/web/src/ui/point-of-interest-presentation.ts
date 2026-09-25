import { getJunctionBonusPercent, getPointOfInterestTerritory, getSharedBorder, PointOfInterestType } from "@vedras/game-core";
import type { GameReadModel } from "../game-read-model";

export interface PointOfInterestPresentation {
  readonly type: PointOfInterestType;
  readonly symbol: string;
  readonly name: string;
  readonly shortEffect: string;
  readonly placementHint: string;
}

export const POINT_OF_INTEREST_PRESENTATIONS: Readonly<Record<PointOfInterestType, PointOfInterestPresentation>> = {
  [PointOfInterestType.Landmark]: {
    type: PointOfInterestType.Landmark, symbol: "★", name: "Wahrzeichen",
    shortEffect: "+25 % Wertung für dieses Gebiet.",
    placementHint: "Wähle eine freie Rasterzelle für das Wahrzeichen.",
  },
  [PointOfInterestType.Junction]: {
    type: PointOfInterestType.Junction, symbol: "◎", name: "Knotenpunkt",
    shortEffect: "+15 % Wertung je unterschiedlichem angrenzenden Gebiet, höchstens +75 %.",
    placementHint: "Wähle eine freie Rasterzelle für den Knotenpunkt.",
  },
  [PointOfInterestType.Fortress]: {
    type: PointOfInterestType.Fortress, symbol: "▲", name: "Festung",
    shortEffect: "+1 Verteidigung im Kampf für dieses Gebiet.",
    placementHint: "Wähle eine freie Rasterzelle für die Festung.",
  },
  [PointOfInterestType.Relic]: {
    type: PointOfInterestType.Relic, symbol: "◆", name: "Relikt",
    shortEffect: "Kontrollierst du mindestens zwei Relikte, erhält jedes deiner Reliktgebiete +25 % Wertung.",
    placementHint: "Wähle eine freie Rasterzelle für das Relikt.",
  },
};

export function getPointOfInterestPresentation(type: PointOfInterestType): PointOfInterestPresentation {
  return POINT_OF_INTEREST_PRESENTATIONS[type];
}

export const POINT_OF_INTEREST_RULE_SUMMARY = Object.values(POINT_OF_INTEREST_PRESENTATIONS)
  .map((item) => `${item.symbol} ${item.name}: ${item.shortEffect}`)
  .join(" ");

export function describePointOfInterest(state: GameReadModel, poi: GameReadModel["pointsOfInterest"][number], territoryId = getPointOfInterestTerritory(state, poi)): string {
  const presentation = getPointOfInterestPresentation(poi.type);
  if (poi.type === PointOfInterestType.Junction) {
    const adjacent = territoryId === undefined || state.map === undefined ? 0
      : state.territories.filter((territory) => territory.id !== territoryId
        && getSharedBorder(state.map!, territoryId, territory.id).segments.length > 0).length;
    return `${presentation.symbol} ${presentation.name} · ${presentation.shortEffect} Aktuell: +${getJunctionBonusPercent(adjacent)} % (${adjacent} Nachbargebiete).`;
  }
  if (poi.type === PointOfInterestType.Relic) {
    const ownerId = territoryId === undefined ? undefined : state.territories.find((territory) => territory.id === territoryId)?.ownerId;
    const controlledRelics = ownerId === undefined || ownerId === null ? 0 : state.pointsOfInterest.filter((item) => {
      const itemTerritoryId = getPointOfInterestTerritory(state, item);
      return item.type === PointOfInterestType.Relic && state.territories.find((territory) => territory.id === itemTerritoryId)?.ownerId === ownerId;
    }).length;
    return `${presentation.symbol} ${presentation.name} · ${presentation.shortEffect} Aktuell: ${controlledRelics}/2 eigene Relikte.`;
  }
  return `${presentation.symbol} ${presentation.name} · ${presentation.shortEffect}`;
}
