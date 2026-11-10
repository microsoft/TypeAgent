// Contract tests for Color's @valid rules (color.ts), run by each contract
// whose implementation returns colors, on the colors it returns. Test names
// are rule IDs.

import { test } from "node:test";
import fc from "fast-check";
import type { Color } from "./color.ts";

export function colorContract(colors: fc.Arbitrary<Color>): void {
  test("Color.rgb-range", () => {
    fc.assert(fc.property(colors, (c) => [c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)));
  });

  test("Color.alpha-range", () => {
    fc.assert(fc.property(colors, (c) => c.a >= 0 && c.a <= 1));
  });
}
