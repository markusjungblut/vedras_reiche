import type { RandomSource } from "../utils/random-source.js";

function rollDie(randomSource: RandomSource): number {
  const value = randomSource.nextInt(1, 6);
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new RangeError("Random source returned an invalid six-sided die result.");
  }
  return value;
}

/** First W6 chooses a pair; second W6 chooses its lower or higher number. */
export function rollActivationNumber(randomSource: RandomSource): number {
  const pair = rollDie(randomSource);
  const choice = rollDie(randomSource);
  return (pair - 1) * 2 + (choice <= 3 ? 1 : 2);
}

/** Rerolls duplicates and preserves the order in which three numbers appeared. */
export function rollActivationNumbers(randomSource: RandomSource): [number, number, number] {
  const numbers: number[] = [];
  while (numbers.length < 3) {
    const value = rollActivationNumber(randomSource);
    if (!numbers.includes(value)) {
      numbers.push(value);
    }
  }
  return numbers as [number, number, number];
}
