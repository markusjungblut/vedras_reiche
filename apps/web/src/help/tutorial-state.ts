export type TutorialStep = "mapCreation" | "pois" | "activation" | "auction" | "war" | "cutAndChoose" | "factions" | "scoring";

export interface TutorialProgress {
  readonly introductionSeen: boolean;
  readonly seen: Readonly<Partial<Record<TutorialStep, true>>>;
}

const STORAGE_KEY = "vedras-reiche-tutorial-progress";
const EMPTY_PROGRESS: TutorialProgress = { introductionSeen: false, seen: {} };

function storage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function loadTutorialProgress(source: Storage | undefined = storage()): TutorialProgress {
  try {
    const parsed = JSON.parse(source?.getItem(STORAGE_KEY) ?? "null") as Partial<TutorialProgress> | null;
    return { introductionSeen: parsed?.introductionSeen === true, seen: parsed?.seen ?? {} };
  } catch { return EMPTY_PROGRESS; }
}

export function saveTutorialProgress(progress: TutorialProgress, source: Storage | undefined = storage()): TutorialProgress {
  source?.setItem(STORAGE_KEY, JSON.stringify(progress));
  return progress;
}

export function markTutorialSeen(progress: TutorialProgress, step: TutorialStep, source: Storage | undefined = storage()): TutorialProgress {
  return saveTutorialProgress({ ...progress, seen: { ...progress.seen, [step]: true } }, source);
}

export function markIntroductionSeen(progress: TutorialProgress, source: Storage | undefined = storage()): TutorialProgress {
  return saveTutorialProgress({ ...progress, introductionSeen: true }, source);
}

export function resetTutorialProgress(source: Storage | undefined = storage()): TutorialProgress {
  source?.removeItem(STORAGE_KEY);
  return EMPTY_PROGRESS;
}
