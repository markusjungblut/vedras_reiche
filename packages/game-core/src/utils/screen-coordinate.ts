/** Structural subset shared by DOMPoint and a test double without a DOM dependency. */
export interface TransformableScreenPoint<Matrix> {
  readonly x: number;
  readonly y: number;
  matrixTransform(matrix: Matrix): { readonly x: number; readonly y: number };
}

export interface InvertibleScreenMatrix<Matrix> {
  inverse(): Matrix;
}

/** Converts a screen-space point through the element's actual inverse transform. */
export function mapScreenPointToLocal<Matrix>(
  point: TransformableScreenPoint<Matrix>,
  screenTransform: InvertibleScreenMatrix<Matrix>,
): { readonly x: number; readonly y: number } {
  const local = point.matrixTransform(screenTransform.inverse());
  return { x: local.x, y: local.y };
}
