import {
  toSetupBorderEdgeKey,
  type GridCell,
  type SetupBorderEdge,
} from "@vedras/game-core";

/** A vertex on the visible grid. It is deliberately distinct from a map cell. */
export interface GridVertex {
  readonly x: number;
  readonly y: number;
}

export interface SetupEdgeSegment {
  readonly x: number;
  readonly y: number;
  readonly dx: 0 | 1;
  readonly dy: 0 | 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sameVertex(left: GridVertex, right: GridVertex): boolean {
  return left.x === right.x && left.y === right.y;
}

function cell(x: number, y: number): GridCell {
  return { x, y };
}

/** Snaps visual SVG coordinates to a real map vertex, never to a map cell. */
export function snapToGridVertex(point: GridVertex, width: number, height: number): GridVertex {
  return {
    x: clamp(Math.round(point.x), 0, width),
    y: clamp(Math.round(point.y), 0, height),
  };
}

/**
 * Converts one physical horizontal grid segment into its internal, zero-area border edge.
 * Segments on the outer map boundary are closed implicitly and therefore need no edge entry.
 */
function horizontalSegmentToEdge(x: number, y: number, width: number, height: number): SetupBorderEdge | undefined {
  if (x < 0 || x >= width || y <= 0 || y >= height) return undefined;
  return { from: cell(x, y - 1), to: cell(x, y) };
}

/** Converts one physical vertical grid segment into its internal, zero-area border edge. */
function verticalSegmentToEdge(x: number, y: number, width: number, height: number): SetupBorderEdge | undefined {
  if (x <= 0 || x >= width || y < 0 || y >= height) return undefined;
  return { from: cell(x - 1, y), to: cell(x, y) };
}

function routeBetween(from: GridVertex, to: GridVertex, width: number, height: number): SetupBorderEdge[] {
  const edges: SetupBorderEdge[] = [];
  let current = from;
  const horizontalFirst = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const moveHorizontal = () => {
    const direction = Math.sign(to.x - current.x);
    while (current.x !== to.x) {
      const edge = horizontalSegmentToEdge(Math.min(current.x, current.x + direction), current.y, width, height);
      if (edge !== undefined) edges.push(edge);
      current = { x: current.x + direction, y: current.y };
    }
  };
  const moveVertical = () => {
    const direction = Math.sign(to.y - current.y);
    while (current.y !== to.y) {
      const edge = verticalSegmentToEdge(current.x, Math.min(current.y, current.y + direction), width, height);
      if (edge !== undefined) edges.push(edge);
      current = { x: current.x, y: current.y + direction };
    }
  };
  if (horizontalFirst) {
    moveHorizontal(); moveVertical();
  } else {
    moveVertical(); moveHorizontal();
  }
  return edges;
}

function uniqueEdges(edges: readonly SetupBorderEdge[]): SetupBorderEdge[] {
  const byKey = new Map<string, SetupBorderEdge>();
  for (const edge of edges) {
    const key = toSetupBorderEdgeKey(edge.from, edge.to);
    if (!byKey.has(key)) byKey.set(key, edge);
  }
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, edge]) => edge);
}

function buildStroke(vertices: readonly GridVertex[], width: number, height: number): SetupBorderEdge[] {
  const edges: SetupBorderEdge[] = [];
  for (let index = 1; index < vertices.length; index += 1) {
    const from = vertices[index - 1]!;
    const to = vertices[index]!;
    if (!sameVertex(from, to)) edges.push(...routeBetween(from, to, width, height));
  }
  return uniqueEdges(edges);
}

/** The precise pen uses every sampled grid vertex. */
export function createPenStroke(points: readonly GridVertex[], width: number, height: number): SetupBorderEdge[] {
  return buildStroke(points.map((point) => snapToGridVertex(point, width, height)), width, height);
}

export function mergeDraftEdges(strokes: readonly (readonly SetupBorderEdge[])[]): SetupBorderEdge[] {
  return uniqueEdges(strokes.flat());
}

/** Converts a core edge back to the physical SVG segment used for draft rendering. */
export function setupBorderEdgeToSegment(edge: SetupBorderEdge): SetupEdgeSegment {
  if (edge.from.x !== edge.to.x) {
    return { x: Math.max(edge.from.x, edge.to.x), y: edge.from.y, dx: 0, dy: 1 };
  }
  return { x: edge.from.x, y: Math.max(edge.from.y, edge.to.y), dx: 1, dy: 0 };
}
