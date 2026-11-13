// The reference for task 11 in phase 3: makeCircle as testCircle.

import type { Point } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";
import { testCircle } from "./viewkit.ts";

export function makeCircle(fields: { center: Point; radius: number; color: Color }): Circle {
  return testCircle(fields);
}
