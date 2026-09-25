/**
 * Deterministic setup-only colors. The golden-angle distribution keeps
 * successive regions visually separated without assigning ownership meaning.
 */
export function getSetupRegionColor(region: string | number): string {
  const index = typeof region === "number" ? region : hashRegionId(region);
  const hue = ((index * 137.508) % 360 + 360) % 360;
  const saturation = 46 + ((Math.floor(index / 5) % 3) * 7);
  const lightness = 34 + ((Math.floor(index / 3) % 3) * 5);
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`;
}

function hashRegionId(id: string): number {
  let hash = 2_166_136_261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return hash >>> 0;
}
