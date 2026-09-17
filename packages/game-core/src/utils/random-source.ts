/** Inclusive integer range; implementations can be seeded or test-controlled. */
export interface RandomSource {
  nextInt(min: number, max: number): number;
}
