// Adversary: a correct stroke, except that intersects is false whenever the pen
// only touches r. Found by the round-1 phase-2 agent; escaped the original suite.

import type { Rectangle } from "../geometry.ts";
import type { InkStroke } from "../shape.ts";
import { inkStrokeContract } from "../inkStroke.contract.ts";
import { makeInkStroke } from "../inkStroke.ts";
import { distPolylineToRect } from "../shape.vocab.ts";

inkStrokeContract((fields) => {
  const s = makeInkStroke(fields);
  const intersects = (r: Rectangle) => s.intersects(r) && distPolylineToRect(s.points, r) < s.thickness / 2;
  return { ...s, kind: s.kind, boundingBox: () => s.boundingBox(), contains: (p) => s.contains(p), intersects } as InkStroke;
});
