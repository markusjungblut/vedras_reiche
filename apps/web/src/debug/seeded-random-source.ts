import type { RandomSource } from "@vedras/game-core";

/** Small reproducible source for local demo games. All rule decisions still run in the core. */
export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("Der Debug-Seed muss eine ganze Zahl sein.");
    }
    this.state = seed >>> 0;
  }

  nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError("Ungültiger Zufallsbereich.");
    }
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return min + (this.state % (max - min + 1));
  }
}
