const SOUND_PREFERENCE_KEY = "vedras-reiche-sound-enabled";

export type SoundCue = "TURN" | "REVEAL" | "WAR" | "GAIN" | "ERROR" | "FINISH" | "CONFIRM";

export function loadSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_PREFERENCE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveSoundPreference(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREFERENCE_KEY, String(enabled));
  } catch { /* Preferences are optional when browser storage is unavailable. */ }
}

/** A small Web Audio cue generator. It is presentation-only and never changes game state. */
class SoundManager {
  private context: AudioContext | undefined;
  private unlocked = false;
  private enabled = true;

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  async unlock(): Promise<void> {
    if (!this.enabled || typeof window === "undefined") return;
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor === undefined) return;
    this.context ??= new AudioContextConstructor();
    try {
      await this.context.resume();
      this.unlocked = this.context.state === "running";
    } catch { /* Browsers may still require a later user gesture. */ }
  }

  play(cue: SoundCue): void {
    if (!this.enabled || !this.unlocked || this.context === undefined || this.context.state !== "running") return;
    const notes: Readonly<Record<SoundCue, readonly [number, number]>> = {
      TURN: [660, 0.06], REVEAL: [740, 0.09], WAR: [180, 0.13], GAIN: [520, 0.1],
      ERROR: [220, 0.1], FINISH: [880, 0.16], CONFIRM: [480, 0.06],
    };
    const note = notes[cue];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = cue === "WAR" || cue === "ERROR" ? "triangle" : "sine";
    oscillator.frequency.value = note[0];
    gain.gain.setValueAtTime(0.0001, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, this.context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + note[1]);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + note[1] + 0.02);
  }
}

export const soundManager = new SoundManager();
