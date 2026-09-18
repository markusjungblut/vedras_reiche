import { GamePhase } from "@vedras/game-core";

const labels: Record<GamePhase, string> = {
  [GamePhase.Setup]: "Vorbereitung",
  [GamePhase.MapCreation]: "Kartenerstellung",
  [GamePhase.StartAuctions]: "Startauktionen",
  [GamePhase.RoundReady]: "Runde bereit",
  [GamePhase.ActivationPhase]: "Aktivierungsphase",
  [GamePhase.ActionPhase]: "Aktionsphase",
  [GamePhase.Scoring]: "Wertung",
  [GamePhase.Finished]: "Beendet",
};

export function phaseLabel(phase: GamePhase): string {
  return labels[phase] ?? phase;
}
