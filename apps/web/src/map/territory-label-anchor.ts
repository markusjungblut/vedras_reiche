import { getTerritoryCells, type GridCell, type GridMapState } from "@vedras/game-core";

export interface LabelAnchor {
  readonly x: number;
  readonly y: number;
  /** Number of orthogonal cell steps to the nearest outer edge. */
  readonly boundaryDistance: number;
}

/**
 * Finds a cell centre that is safely inside a set of raster cells.  A
 * multi-source breadth-first search gives every cell its distance to the
 * outside, so concave territories cannot place a label in a neighbouring
 * region as a bounding-box centre can.
 */
export function getCellLabelAnchor(cells: readonly GridCell[]): LabelAnchor | undefined {
  if (cells.length === 0) return undefined;
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  const distanceByKey = new Map<string, number>();
  const queue: GridCell[] = [];

  for (const cell of cells) {
    const neighbours = [
      `${cell.x - 1},${cell.y}`,
      `${cell.x + 1},${cell.y}`,
      `${cell.x},${cell.y - 1}`,
      `${cell.x},${cell.y + 1}`,
    ];
    if (neighbours.some((key) => !keys.has(key))) {
      const key = `${cell.x},${cell.y}`;
      distanceByKey.set(key, 0);
      queue.push(cell);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index]!;
    const distance = distanceByKey.get(`${cell.x},${cell.y}`)!;
    for (const neighbour of [
      { x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 },
    ]) {
      const key = `${neighbour.x},${neighbour.y}`;
      if (keys.has(key) && !distanceByKey.has(key)) {
        distanceByKey.set(key, distance + 1);
        queue.push(neighbour);
      }
    }
  }

  const winner = [...cells].sort((left, right) => {
    const distanceDelta = (distanceByKey.get(`${right.x},${right.y}`) ?? 0) - (distanceByKey.get(`${left.x},${left.y}`) ?? 0);
    return distanceDelta || left.y - right.y || left.x - right.x;
  })[0]!;
  return {
    x: winner.x + .5,
    y: winner.y + .5,
    boundaryDistance: distanceByKey.get(`${winner.x},${winner.y}`) ?? 0,
  };
}

/** Moves a label away from a strategic point when the normal interior anchor
 * would overlap it. The fallback stays on a cell centre of the same territory. */
export function getCellLabelAnchorAwayFromPoints(cells: readonly GridCell[], points: readonly GridCell[]): LabelAnchor | undefined {
  const defaultAnchor = getCellLabelAnchor(cells);
  if (defaultAnchor === undefined || points.length === 0) return defaultAnchor;
  const closestDistance = Math.min(...points.map((point) => Math.hypot(defaultAnchor.x - point.x - .5, defaultAnchor.y - point.y - .5)));
  if (closestDistance > 1.1) return defaultAnchor;
  const distanceToPoint = (cell: GridCell) => Math.min(...points.map((point) => Math.hypot(cell.x - point.x, cell.y - point.y)));
  const candidate = [...cells].sort((left, right) => distanceToPoint(right) - distanceToPoint(left)
    || Math.hypot(left.x + .5 - defaultAnchor.x, left.y + .5 - defaultAnchor.y) - Math.hypot(right.x + .5 - defaultAnchor.x, right.y + .5 - defaultAnchor.y))[0];
  return candidate === undefined ? defaultAnchor : {
    x: candidate.x + .5,
    y: candidate.y + .5,
    boundaryDistance: defaultAnchor.boundaryDistance,
  };
}

export function getTerritoryLabelAnchor(map: GridMapState, territoryId: string): LabelAnchor | undefined {
  return getCellLabelAnchor(getTerritoryCells(map, territoryId));
}
