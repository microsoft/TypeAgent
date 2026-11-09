/**
 * Vocabulary for rule expressions about color.ts: compositing. Re-exports
 * rules.ts.
 *
 * @module
 */

import type { Color } from "./color.ts";

export * from "./rules.ts";

/**
 * Colors composited bottom to top with source-over, starting from
 * transparent. Straight (not premultiplied) alpha in and out. The result is
 * not rounded, so its r, g and b need not be integers; transparent is all
 * zeros.
 */
export function over(colors: readonly Color[]): Color {
  // Accumulate premultiplied values.
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const c of colors) {
    r = c.r * c.a + r * (1 - c.a);
    g = c.g * c.a + g * (1 - c.a);
    b = c.b * c.a + b * (1 - c.a);
    a = c.a + a * (1 - c.a);
  }
  return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: r / a, g: g / a, b: b / a, a };
}
