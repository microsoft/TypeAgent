/**
 * Colors. Kept apart from geometry and shapes because color never affects
 * where a shape is: shapes such as InkStroke carry a Color, but bounding
 * boxes, queries and locators never read it. Rules follow the format
 * described in rules.ts.
 *
 * @module
 */

/**
 * An sRGB color with straight (not premultiplied) alpha.
 *
 * @valid rgb-range  r, g and b are integers from 0 to 255.
 *   [this.r, this.g, this.b].every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
 * @valid alpha-range  a is from 0 (transparent) to 1 (opaque).
 *   this.a >= 0 && this.a <= 1
 */
export interface Color {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}
