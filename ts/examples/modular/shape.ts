/**
 * Shapes and finding them. A Shape is a region of the plane, and each shape
 * type, such as InkStroke or Circle, adds its own rules. A ShapeLocator
 * finds shapes by location, under their ShapeIds. The collection of shapes
 * a drawing holds is in shapeModel.ts.
 *
 * Rules follow the format described in rules.ts.
 *
 * @module
 */

import type { Point, Rectangle } from "./geometry.ts";
import type { Color } from "./color.ts";

/**
 * A region of the plane, such as an ink stroke.
 *
 * Every non-empty shape has nonzero area: a shape drawn as a line is a
 * stroked region with a positive thickness. Shapes follow Rectangle's
 * half-open convention at their extremes: a point at the shape's maximum x
 * or maximum y is not in the shape.
 *
 * A shape's methods agree with one another as actually computed, rounding
 * included: contains and intersects never reach outside the rectangle that
 * boundingBox returns.
 *
 * @invariant immutable  A shape's data fields, including nested ones, keep the values they had when it was made.
 * @ensures deterministic  Every method returns the same result each time it is called with the same arguments.
 */
export interface Shape {
    /**
     * Identifies the shape's type. Each shape type declares its own unique
     * literal.
     */
    readonly kind: string;

    /**
     * The exact extents of the shape: x and y are its minimum x and y, and
     * x + width and y + height are its maximum x and y. Because of the
     * half-open convention, this rectangle contains every point the shape
     * contains. Empty only for a shape that contains no points.
     *
     * @abstract exact  The rectangle is exactly the shape's extents; each shape type states this for its own geometry.
     */
    boundingBox(): Rectangle;

    /**
     * Whether at least one point lies both in this shape and in r.
     *
     * @ensures empty-rect  Never intersects an empty rectangle.
     *   implies(isEmpty(r), !result)
     * @ensures implies-box  If the shape intersects r, so does its bounding box.
     *   implies(result, rectIntersects(this.boundingBox(), r))
     * @ensures witness  If some point is in both the shape and r, they intersect.
     *   (p: Point) => implies(this.contains(p) && rectContains(r, p), result)
     * @abstract only-shared  Intersects r only when some point is in both; each shape type states this for its own geometry.
     */
    intersects(r: Rectangle): boolean;

    /**
     * Whether p lies in the shape. Apart from the half-open rule at the maximum
     * x and y, each shape type defines its own boundary rule.
     *
     * @ensures implies-box  Every point in the shape is in its bounding box.
     *   implies(result, rectContains(this.boundingBox(), p))
     */
    contains(p: Point): boolean;
}

/**
 * A stroke of digital ink: a polyline drawn with a round pen. Consecutive
 * duplicate points are allowed. Color does not affect geometry.
 *
 * The half-open rule applies to the whole stroke: whether a point on the
 * pen's edge is contained can depend on points far away, because they set
 * the stroke's maximum x and y.
 *
 * @valid has-points  Has at least one point; a single point draws a dot.
 *   this.points.length >= 1
 * @valid min-thickness  Thickness is at least 1.
 *   this.thickness >= 1
 * @ensures box  The bounding box is the points' extents, grown by half the thickness.
 *   deepEqual(this.boundingBox(), inflate(extents(this.points), this.thickness / 2))
 * @ensures round-pen  Covers every point within half the thickness of the polyline that lies in its bounding box as computed.
 *   (p: Point) => this.contains(p) ===
 *     (distToPolyline(p, this.points) <= this.thickness / 2 && rectContains(this.boundingBox(), p))
 * @ensures exact-intersects  Intersects r exactly when some point it contains is in r; when the pen only touches r, contains() decides.
 *   (r: Rectangle) => implies(!isEmpty(r) && distPolylineToRect(this.points, r) < this.thickness / 2, this.intersects(r)) &&
 *     implies(distPolylineToRect(this.points, r) > this.thickness / 2, !this.intersects(r))
 * @refines Shape.boundingBox.exact  box
 * @refines Shape.intersects.only-shared  exact-intersects
 */
export interface InkStroke extends Shape {
    readonly kind: "ink";
    /** The polyline's vertices, in drawing order. */
    readonly points: readonly Point[];
    /** Pen diameter, in canonical units. */
    readonly thickness: number;
    readonly color: Color;
}

/**
 * A filled circle: the points within radius of center, with the half-open
 * rule at its maximum x and y. It covers the same region as a one-point
 * InkStroke with thickness 2 * radius, and its rules are those rules with
 * [center] as the polyline.
 *
 * @valid positive-radius  The radius is greater than 0.
 *   this.radius > 0
 * @ensures box  The bounding box is the center grown by the radius.
 *   deepEqual(this.boundingBox(), inflate(extents([this.center]), this.radius))
 * @ensures disk  Covers every point within the radius of the center that lies in its bounding box as computed.
 *   (p: Point) => this.contains(p) ===
 *     (distToPolyline(p, [this.center]) <= this.radius && rectContains(this.boundingBox(), p))
 * @ensures exact-intersects  Intersects r exactly when some point it contains is in r; when the circle only touches r, contains() decides.
 *   (r: Rectangle) => implies(!isEmpty(r) && distPolylineToRect([this.center], r) < this.radius, this.intersects(r)) &&
 *     implies(distPolylineToRect([this.center], r) > this.radius, !this.intersects(r))
 * @refines Shape.boundingBox.exact  box
 * @refines Shape.intersects.only-shared  exact-intersects
 */
export interface Circle extends Shape {
    readonly kind: "circle";
    readonly center: Point;
    /** In canonical units. */
    readonly radius: number;
    readonly color: Color;
}

/**
 * Identifies a shape on every client. Made by
 * ShapeMessageProcessor.newShapeId (shapeModel.ts). The brand is
 * compile-time only: a plain string at runtime, but other strings can't be
 * passed as one.
 */
export type ShapeId = string & { readonly __brand: "ShapeId" };

/**
 * Finds shapes by location. Read-only.
 *
 * Queries append to out and return the number of IDs appended. Results are in
 * no particular order. Rules use indexed(this), the shapes the queries are
 * about (see shape.vocab.ts).
 *
 * @ensures no-retain  Never keeps a reference to out after returning: later calls leave earlier out arrays unchanged.
 * @ensures read-only  Queries never change what is indexed.
 */
export interface ShapeLocatorQueries {
    /**
     * Finds the shapes that intersect r.
     *
     * @ensures exact  Reports exactly the indexed shapes that intersect r.
     *   sameSet(out.slice(old(out.length)),
     *     [...indexed(this)].filter(([, s]) => s.intersects(r)).map(([id]) => id))
     * @ensures once  Reports each ID at most once.
     *   unique(out.slice(old(out.length)))
     * @ensures append  Leaves what was already in out unchanged.
     *   deepEqual(out.slice(0, old(out.length)), old([...out]))
     * @ensures count  Returns the number of IDs appended.
     *   result === out.length - old(out.length)
     */
    inRect(r: Rectangle, out: ShapeId[]): number;

    /**
     * Finds the shapes that contain p.
     *
     * @ensures exact  Reports exactly the indexed shapes that contain p.
     *   sameSet(out.slice(old(out.length)),
     *     [...indexed(this)].filter(([, s]) => s.contains(p)).map(([id]) => id))
     * @ensures once  Reports each ID at most once.
     *   unique(out.slice(old(out.length)))
     * @ensures append  Leaves what was already in out unchanged.
     *   deepEqual(out.slice(0, old(out.length)), old([...out]))
     * @ensures count  Returns the number of IDs appended.
     *   result === out.length - old(out.length)
     */
    atPoint(p: Point, out: ShapeId[]): number;
}

/**
 * A spatial index that finds shapes by location, such as a quadtree. It holds
 * IDs and geometry only.
 *
 * indexed(this) is the shapes added and not yet removed, as tracked by the
 * test harness.
 *
 * @ensures any-extent  Accepts any shape that satisfies add's in-range rule; there is no fixed extent.
 */
export interface ShapeLocator extends ShapeLocatorQueries {
    /**
     * Indexes shape under id.
     *
     * IDs that were removed may be added again, and one shape object may be
     * indexed under several IDs.
     *
     * @requires new-id  The ID is not already indexed.
     *   !indexed(this).has(id)
     * @requires in-range  The shape's bounding box lies within ±1e300, right and bottom edges included.
     *   inRange(shape.boundingBox(), 1e300)
     * @ensures indexed  Afterward, inRect finds the shape by its own bounding box, if the shape intersects that box.
     *   implies(shape.intersects(shape.boundingBox()), this.inRect(shape.boundingBox(), []) >= 1)
     */
    add(id: ShapeId, shape: Shape): void;

    /**
     * Removes id from the index.
     *
     * @ensures result  Returns whether the ID was indexed.
     *   result === old(indexed(this).has(id))
     * @ensures gone  No query finds the ID afterward, until it is added again.
     */
    remove(id: ShapeId): boolean;

    /**
     * Removes every listed ID that is present. ids may contain duplicates and
     * IDs that aren't present; both are ignored. Implementations may reorganize
     * their internal structure once for the whole batch.
     *
     * @ensures count  Returns the number of IDs actually removed.
     *   result === old(indexed(this).size) - indexed(this).size
     * @ensures same-as-remove  Has the same effect as calling remove() on each ID, in any order.
     */
    removeMultiple(ids: readonly ShapeId[]): number;
}
