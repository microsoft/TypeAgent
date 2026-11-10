/**
 * Geometry: points, rectangles and viewports.
 *
 * Points and rectangles have no coordinate space of their own; each use
 * says which space it is in. Every space is oriented like the screen: x
 * increases to the right and y increases downward. The spaces:
 * - canonical: the model's, in which shapes and scenes are stored.
 * - window: (0, 0) at the window's top left. Layout objects' regions and
 *   distributed events' points (layout.ts) are in it.
 * - view: (0, 0) at the top left of a view's surface.
 * Window and view coordinates are both in layout units, the platform's
 * density-independent unit (CSS pixels, iOS points, Android dp), so moving
 * between them is a translation by the surface's top left. A Viewport
 * maps canonical coordinates to view coordinates.
 *
 * Points, rectangles and viewports are immutable values.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

/** A location, in the coordinate space its use states. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

/**
 * An axis-aligned rectangle covering the half-open region
 * [x, x + width) × [y, y + height). (x, y) is the top-left corner. The left
 * and top edges are inside, and the right and bottom edges are not, so two
 * rectangles that share only an edge do not overlap. A rectangle with width 0
 * or height 0 is empty and contains no points.
 *
 * @valid non-negative-size  Width and height are never negative.
 *   this.width >= 0 && this.height >= 0
 */
export interface Rectangle {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** A side of a rectangle. */
export type Edge = "top" | "bottom" | "left" | "right";

/** Where a smaller rectangle goes within a larger one, along one axis. */
export type Align = "start" | "center" | "end";

/**
 * Operations on rectangles, following Rectangle's half-open semantics.
 * cut, splitHoriz, splitVert, inset and place are each defined exactly by
 * their reference functions in geometry.vocab.ts.
 *
 * @ensures no-mutation  Never modifies its arguments.
 */
export interface RectangleOps {
    /**
     * Whether p lies in r.
     *
     * @ensures half-open  Left and top edges are inside; right and bottom edges are not.
     *   result === (r.x <= p.x && p.x < r.x + r.width && r.y <= p.y && p.y < r.y + r.height)
     */
    contains(r: Rectangle, p: Point): boolean;

    /**
     * Whether a and b overlap.
     *
     * @ensures nonzero-area  True only for overlap of nonzero area; shared edges, corners and empty rectangles don't count.
     *   result === (!isEmpty(a) && !isEmpty(b) &&
     *     a.x < b.x + b.width && b.x < a.x + a.width &&
     *     a.y < b.y + b.height && b.y < a.y + a.height)
     * @ensures symmetric  The order of the arguments doesn't matter.
     *   result === this.intersects(b, a)
     */
    intersects(a: Rectangle, b: Rectangle): boolean;

    /**
     * Cuts a strip of the given size off one edge of r. Returns the strip
     * and the rest, which together tile r. A size larger than r takes all
     * of it, leaving an empty rest at the far side.
     *
     * @requires non-negative  size is at least 0.
     *   size >= 0
     * @ensures exact  Returns the strip and the rest as cutRect defines them.
     *   deepEqual(result, cutRect(r, edge, size))
     */
    cut(r: Rectangle, edge: Edge, size: number): [Rectangle, Rectangle];

    /**
     * Splits r left to right into one rectangle per weight, each as wide as
     * its share of r's width, and as tall as r. splitHoriz(r, 5, 10, 5)
     * gives a quarter, a half and a quarter.
     *
     * @requires weights  At least one weight, and every weight greater than 0.
     *   weights.length > 0 && weights.every((w) => w > 0)
     * @ensures exact  Returns the rectangles splitRect defines: widths by largest remainder, side by side, tiling r.
     *   deepEqual(result, splitRect(r, "horizontal", weights))
     */
    splitHoriz(r: Rectangle, ...weights: number[]): Rectangle[];

    /**
     * Splits r top to bottom into one rectangle per weight, each as tall as
     * its share of r's height, and as wide as r.
     *
     * @requires weights  At least one weight, and every weight greater than 0.
     *   weights.length > 0 && weights.every((w) => w > 0)
     * @ensures exact  Returns the rectangles splitRect defines: heights by largest remainder, stacked, tiling r.
     *   deepEqual(result, splitRect(r, "vertical", weights))
     */
    splitVert(r: Rectangle, ...weights: number[]): Rectangle[];

    /**
     * r shrunk by d on every side. When r is too small, the result is empty
     * along that axis, at r's center.
     *
     * @requires non-negative  d is at least 0.
     *   d >= 0
     * @ensures exact  Returns the rectangle insetRect defines.
     *   deepEqual(result, insetRect(r, d))
     */
    inset(r: Rectangle, d: number): Rectangle;

    /**
     * A rectangle of the given size placed within r, aligned along each
     * axis at the start, the center (rounded down to a whole unit) or the
     * end. A size larger than r is reduced to r's.
     *
     * @requires non-negative  The size's width and height are at least 0.
     *   size.width >= 0 && size.height >= 0
     * @ensures exact  Returns the rectangle placeRect defines.
     *   deepEqual(result, placeRect(r, size, alignX, alignY))
     */
    place(r: Rectangle, size: { readonly width: number; readonly height: number }, alignX: Align, alignY: Align): Rectangle;
}

/**
 * A 2D similarity transform (uniform scale, rotation, translation) from
 * canonical coordinates to view coordinates (see the top of this file).
 *
 * The mapping scales and rotates about the canonical origin, then translates:
 *   vx = scale * (cos(rotation) * x - sin(rotation) * y) + tx
 *   vy = scale * (sin(rotation) * x + cos(rotation) * y) + ty
 *
 * @valid positive-scale  Scale is greater than 0.
 *   this.scale > 0
 */
export interface Viewport {
    /** View units per canonical unit. */
    readonly scale: number;
    /** Radians. Positive is clockwise on screen, because y points down. */
    readonly rotation: number;
    readonly tx: number;
    readonly ty: number;
}
