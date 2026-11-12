/**
 * makeCircle implements Circle.
 *
 * How: It checks the fields against Circle's positive-radius rule, Color's
 * range rules and the finite-number rule, copies them, and returns a frozen
 * object whose methods close over the copies and over the bounding box, which
 * is computed once. contains tests the half-open box and then the closed disk;
 * intersects clamps the center into the overlap of the box and the rectangle.
 * Choose when: Whenever a filled circle is needed; it is also the cheap
 * stand-in for a one-point InkStroke, whose region it shares.
 * Cost: makeCircle is constant time and allocates four objects: the center,
 * the color, the bounding box and the circle. boundingBox, contains and
 * intersects are constant time and allocate nothing; boundingBox returns the
 * same object every call, and contains and intersects each compute one
 * Math.hypot.
 * AdditionalSemantics: Every rejected field set throws a RangeError whose
 * message names the rule it breaks; the checks run in the order radius,
 * color, finite, so a field set breaking several rules reports the first.
 * The circle, its center, its color and its bounding box are frozen, so
 * writing to them throws in strict mode, and center and color hold only the
 * fields the interface declares: other properties of the caller's objects are
 * dropped. Outside the rules, fields whose static type is wrong, such as a
 * missing center, throw a TypeError rather than a RangeError.
 * Parts: The nearest-point search in intersects is the half-open distance from
 * a point to the overlap of two rectangles; every shape type with a convex
 * pen needs it, so it could become a rectangle-geometry operation of its own.
 * Imports: geometry.ts, color.ts, shape.ts
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";
import type { Circle } from "./shape.ts";

/** Whether v is one of Color's 0-to-255 integer channels. */
function isChannel(v: number): boolean {
    return Number.isInteger(v) && v >= 0 && v <= 255;
}

/**
 * A filled circle holding its own copy of its fields.
 *
 * Throws a RangeError when the fields break Circle's positive-radius rule or
 * one of Color's range rules, or when any of their numbers is not finite.
 */
export function makeCircle(fields: { center: Point; radius: number; color: Color }): Circle {
    const radius = fields.radius;
    const cx = fields.center.x;
    const cy = fields.center.y;
    const { r, g, b, a } = fields.color;
    if (!(radius > 0)) {
        throw new RangeError("Circle.positive-radius: the radius must be greater than 0");
    }
    if (!isChannel(r) || !isChannel(g) || !isChannel(b)) {
        throw new RangeError("Color.rgb-range: r, g and b must be integers from 0 to 255");
    }
    if (!(a >= 0 && a <= 1)) {
        throw new RangeError("Color.alpha-range: a must be from 0 to 1");
    }
    if (![cx, cy, radius, r, g, b, a].every((v) => Number.isFinite(v))) {
        throw new RangeError("every number must be finite");
    }

    const center: Point = Object.freeze({ x: cx, y: cy });
    const color: Color = Object.freeze({ r, g, b, a });
    // The center grown by the radius (Circle.box), as inflate computes it.
    const box: Rectangle = Object.freeze({
        x: cx - radius,
        y: cy - radius,
        width: 2 * radius,
        height: 2 * radius,
    });
    // The excluded edges, derived from the box exactly as the rules' right()
    // and bottom() derive them, so the methods agree with it as computed.
    const boxRight = box.x + box.width;
    const boxBottom = box.y + box.height;

    /** In the half-open box, and within the radius of the center. */
    const contains = (p: Point): boolean =>
        box.x <= p.x && p.x < boxRight && box.y <= p.y && p.y < boxBottom &&
        Math.hypot(p.x - cx, p.y - cy) <= radius;

    /**
     * Some point of the half-open overlap of the box and r is within the
     * radius of the center. The overlap's nearest point to the center is the
     * center clamped to each axis; on an axis whose clamp lands on the
     * overlap's excluded right or bottom edge, that distance is a limit the
     * region never reaches, so the comparison with the radius turns strict.
     * An exact touch therefore counts only where contains() accepts it.
     */
    const intersects = (r2: Rectangle): boolean => {
        const left = Math.max(box.x, r2.x);
        const top = Math.max(box.y, r2.y);
        const right = Math.min(boxRight, r2.x + r2.width);
        const bottom = Math.min(boxBottom, r2.y + r2.height);
        if (!(left < right) || !(top < bottom)) return false;
        const dx = cx < left ? left - cx : cx < right ? 0 : cx - right;
        const dy = cy < top ? top - cy : cy < bottom ? 0 : cy - bottom;
        const d = Math.hypot(dx, dy);
        const reached = cx < right && cy < bottom;
        return reached ? d <= radius : d < radius;
    };

    const circle: Circle = {
        kind: "circle",
        center,
        radius,
        color,
        boundingBox: () => box,
        contains,
        intersects,
    };
    return Object.freeze(circle);
}
