import { useCallback, useEffect, useRef, useState } from "react";
import { soundManager } from "../ui/sound-manager";
import {
  EMPTY_PRESENTATION_STATE,
  type PresentationEvent,
  type PresentationState,
  type TerritoryGainWave,
  type TerritoryPulse,
  type TerritorySuitConfirmation,
  type WarDiceReveal,
} from "./game-presentation";

const ACTIVATION_STEP_MS = 360;
const PULSE_MS = 640;
const SUIT_MS = 620;
const WAVE_MS = 920;
const AUCTION_MS = 1_020;
const WAR_MS = 1_260;

type TimerKey = string;

function withoutId<T extends { readonly id: string }>(items: readonly T[], id: string): readonly T[] {
  return items.filter((item) => item.id !== id);
}

/** Short, cancellable UI-only playback for newly received authoritative events. */
export function usePresentationPlayback(): {
  readonly presentation: PresentationState;
  readonly present: (events: readonly PresentationEvent[]) => void;
  readonly reset: () => void;
} {
  const [presentation, setPresentation] = useState<PresentationState>(EMPTY_PRESENTATION_STATE);
  const timers = useRef(new Map<TimerKey, number[]>());

  const clearTimers = useCallback((key?: TimerKey) => {
    const entries = key === undefined ? [...timers.current.entries()] :
      [[key, timers.current.get(key) ?? []] as const];
    for (const [entryKey, values] of entries) {
      values.forEach((timer) => window.clearTimeout(timer));
      timers.current.delete(entryKey);
    }
  }, []);

  const schedule = useCallback((key: TimerKey, delayMs: number, callback: () => void) => {
    const timer = window.setTimeout(() => {
      const remaining = timers.current.get(key)?.filter((candidate) => candidate !== timer) ?? [];
      if (remaining.length === 0) timers.current.delete(key);
      else timers.current.set(key, remaining);
      callback();
    }, delayMs);
    timers.current.set(key, [...(timers.current.get(key) ?? []), timer]);
  }, []);

  const presentPulse = useCallback((pulse: TerritoryPulse, delayMs = 0) => {
    const key = "pulse:" + pulse.id;
    schedule(key, delayMs, () => {
      setPresentation((current) => ({
        ...current,
        territoryPulses: [...withoutId(current.territoryPulses, pulse.id), pulse],
      }));
      schedule(key, pulse.durationMs, () => setPresentation((current) => ({
        ...current,
        territoryPulses: withoutId(current.territoryPulses, pulse.id),
      })));
    });
  }, [schedule]);

  const presentSuit = useCallback((confirmation: TerritorySuitConfirmation) => {
    const key = "suit:" + confirmation.id;
    setPresentation((current) => ({
      ...current,
      suitConfirmations: [...withoutId(current.suitConfirmations, confirmation.id), confirmation],
    }));
    schedule(key, SUIT_MS, () => setPresentation((current) => ({
      ...current,
      suitConfirmations: withoutId(current.suitConfirmations, confirmation.id),
    })));
  }, [schedule]);

  const presentWave = useCallback((wave: TerritoryGainWave, playSound: boolean) => {
    const key = "wave:" + wave.id;
    schedule(key, wave.delayMs, () => {
      if (playSound) soundManager.play("GAIN");
      setPresentation((current) => ({
        ...current,
        gainWaves: [...withoutId(current.gainWaves, wave.id), wave],
      }));
      schedule(key, WAVE_MS, () => setPresentation((current) => ({
        ...current,
        gainWaves: withoutId(current.gainWaves, wave.id),
      })));
    });
  }, [schedule]);

  const presentActivation = useCallback((event: Extract<PresentationEvent, { readonly type: "ACTIVATION_ROLL_REVEAL" }>) => {
    const key = "activation";
    clearTimers(key);
    setPresentation((current) => ({
      ...current,
      activationReveal: { id: event.id, numbers: event.numbers, revealedCount: 0 },
      territoryPulses: current.territoryPulses.filter((pulse) => !pulse.id.startsWith("activation:")),
    }));
    event.numbers.forEach((number, index) => {
      schedule(key, index * ACTIVATION_STEP_MS, () => {
        setPresentation((current) => {
          if (current.activationReveal?.id !== event.id) return current;
          return { ...current, activationReveal: { ...current.activationReveal, revealedCount: index + 1 } };
        });
        event.territoryIdsByNumber[number]?.forEach((territoryId) => presentPulse({
          type: "ACTIVATION_TERRITORY_PULSE",
          id: "activation:" + event.id + ":" + index + ":" + territoryId,
          territoryId,
          durationMs: PULSE_MS,
        }));
      });
    });
    schedule(key, event.numbers.length * ACTIVATION_STEP_MS + 210, () => setPresentation((current) => {
      if (current.activationReveal?.id !== event.id) return current;
      const { activationReveal: _activationReveal, ...withoutActivation } = current;
      return withoutActivation;
    }));
  }, [clearTimers, presentPulse, schedule]);

  const presentWar = useCallback((event: WarDiceReveal) => {
    const key = "war";
    clearTimers(key);
    setPresentation((current) => ({ ...current, warDice: { ...event, stage: 1 } }));
    ([2, 3, 4] as const).forEach((stage, index) => schedule(key, [220, 460, 740][index]!, () => {
      setPresentation((current) => current.warDice?.id === event.id
        ? { ...current, warDice: { ...current.warDice, stage } }
        : current);
    }));
    schedule(key, WAR_MS, () => setPresentation((current) => {
      if (current.warDice?.id !== event.id) return current;
      const { warDice: _warDice, ...withoutWar } = current;
      return withoutWar;
    }));
  }, [clearTimers, schedule]);

  const presentAuction = useCallback((event: Extract<PresentationEvent, { readonly type: "AUCTION_RESULT_REVEAL" }>) => {
    const key = "auction";
    clearTimers(key);
    setPresentation((current) => ({ ...current, auctionResult: event }));
    schedule(key, AUCTION_MS, () => setPresentation((current) => {
      if (current.auctionResult?.id !== event.id) return current;
      const { auctionResult: _auctionResult, ...withoutAuction } = current;
      return withoutAuction;
    }));
  }, [clearTimers, schedule]);

  const present = useCallback((events: readonly PresentationEvent[]) => {
    let playedGain = false;
    for (const event of events) {
      switch (event.type) {
        case "ACTIVATION_ROLL_REVEAL":
          soundManager.play("TURN");
          presentActivation(event);
          break;
        case "ACTIVATION_TERRITORY_PULSE":
          presentPulse(event);
          break;
        case "TERRITORY_SUIT_CONFIRM":
          presentSuit(event);
          break;
        case "TERRITORY_GAIN_WAVE":
          presentWave(event, !playedGain);
          playedGain = true;
          break;
        case "AUCTION_RESULT_REVEAL":
          soundManager.play("REVEAL");
          presentAuction(event);
          break;
        case "WAR_DICE_REVEAL":
          soundManager.play("WAR");
          presentWar(event);
          break;
        case "GAME_FINISHED":
          soundManager.play("FINISH");
          break;
      }
    }
  }, [presentActivation, presentAuction, presentPulse, presentSuit, presentWar, presentWave]);

  const reset = useCallback(() => {
    clearTimers();
    setPresentation(EMPTY_PRESENTATION_STATE);
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { presentation, present, reset };
}
