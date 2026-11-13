/**
 * Tells two implementations of shapeProcessor.ts apart: each test passes on
 * one of them and fails on the other. Everything here is a valid use of the
 * interfaces: operations are stamped or sequenced as MessageProcessor's
 * @requires ask, add IDs come from a newShapeId of the client that made the
 * add, nothing enqueues while a process call is pending, and no operation is
 * changed after it is enqueued. What each test looks at, and whether the
 * spec decides it, is in REPORT.md.
 *
 * Imports: node:test, node:assert/strict, node:perf_hooks,
 *   shapeProcessor.ts, shapewriterkit.ts, geometry.vocab.ts, geometry.ts,
 *   shape.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { Point, Rectangle } from "./geometry.ts";
import type { Shape, ShapeId } from "./shape.ts";
import { ShapeProcessor } from "./shapeProcessor.ts";
import { RefShapeWriter } from "./shapewriterkit.ts";
import { rectContains, rectIntersects } from "./geometry.vocab.ts";

/**
 * The reference writer, recording how the processor calls it: a writer is
 * what the processor changes the shapes through, so its calls are part of
 * what the interfaces show.
 */
class SpyWriter extends RefShapeWriter {
  /** The arguments after shape of each add: empty when below was left out. */
  readonly addArgs: (ShapeId | undefined)[][] = [];
  /** The array each remove was called with, as passed. */
  readonly removeArgs: (readonly ShapeId[])[] = [];

  override add(id: ShapeId, shape: Shape, ...rest: (ShapeId | undefined)[]): void {
    this.addArgs.push(rest);
    super.add(id, shape, rest[0]);
  }

  override remove(listed: readonly ShapeId[]): number {
    this.removeArgs.push(listed);
    // Removing nothing removes nothing, so this is the reference result
    // without its scan: the writer's cost can't hide the processor's.
    return listed.length === 0 ? 0 : super.remove(listed);
  }
}

/** A shape that covers exactly its bounding box: a unit square at the origin. */
class UnitBox implements Shape {
  readonly kind = "unit-box";
  private readonly box: Rectangle = { x: 0, y: 0, width: 1, height: 1 };

  boundingBox(): Rectangle {
    return this.box;
  }

  contains(p: Point): boolean {
    return rectContains(this.box, p);
  }

  intersects(r: Rectangle): boolean {
    return rectIntersects(this.box, r);
  }
}

/** A shape to add; the processor only carries it to the writer. */
const aShape = (): Shape => new UnitBox();

/** IDs for another client's adds, from that client's own newShapeId. */
function otherIds(clientId: string, n: number): ShapeId[] {
  const source = new ShapeProcessor(clientId, new RefShapeWriter());
  const ids: ShapeId[] = [];
  for (let i = 0; i < n; i++) ids.push(source.newShapeId());
  return ids;
}

/** The last array a remove was called with. */
function lastRemove(writer: SpyWriter): readonly ShapeId[] | undefined {
  return writer.removeArgs[writer.removeArgs.length - 1];
}

test("local add calls the writer with no below argument", async () => {
  const writer = new SpyWriter();
  const processor = new ShapeProcessor("me", writer);
  processor.local.enqueue({ type: "add", id: processor.newShapeId(), shape: aShape() });
  await processor.process();
  // A leaves below out; B passes it as undefined.
  assert.deepEqual(writer.addArgs, [[]]);
});

test("local remove hands the writer the content's own ids array", async () => {
  const writer = new SpyWriter();
  const processor = new ShapeProcessor("me", writer);
  const id = processor.newShapeId();
  processor.local.enqueue({ type: "add", id, shape: aShape() });
  await processor.process();
  const ids: ShapeId[] = [id];
  processor.local.enqueue({ type: "remove", ids });
  await processor.process();
  // A queues the content's own array and passes it on; B copies it.
  assert.strictEqual(lastRemove(writer), ids);
});

test("remote remove hands the writer the enqueued operation's ids array", async () => {
  const writer = new SpyWriter();
  const processor = new ShapeProcessor("me", writer);
  const [theirs] = otherIds("other", 1);
  processor.remote.enqueue({ type: "add", id: theirs, shape: aShape(), clientId: "other", clientSeq: 0, refSeq: -1, seq: 0 });
  await processor.process();
  const ids: ShapeId[] = [theirs];
  processor.remote.enqueue({ type: "remove", ids, clientId: "other", clientSeq: 1, refSeq: 0, seq: 1 });
  await processor.process();
  // A queues the caller's operation itself and passes its array on; B copies.
  assert.strictEqual(lastRemove(writer), ids);
});

test("local enqueue keeps a property the operation type does not declare", async () => {
  const processor = new ShapeProcessor("me", new RefShapeWriter());
  // A content object with a field of its own, which the operation's type
  // doesn't declare and no rule mentions.
  const content = { type: "clear" as const, origin: "a tool" };
  const stamped = processor.local.enqueue(content);
  await processor.process();
  // A stamps a copy of the content; B builds the operation field by field.
  assert.ok("origin" in stamped);
});

test("a clear lists what it removes in the order the adds were applied", async () => {
  const writer = new SpyWriter();
  const processor = new ShapeProcessor("me", writer);
  const mine = processor.newShapeId();
  processor.local.enqueue({ type: "add", id: mine, shape: aShape() });
  await processor.process();
  const [theirs] = otherIds("other", 1);
  processor.remote.enqueue({ type: "add", id: theirs, shape: aShape(), clientId: "other", clientSeq: 0, refSeq: -1, seq: 0 });
  await processor.process();
  // This clear knew their add (its seq is at most the clear's refSeq, 0) and
  // its own earlier add, so both shapes go.
  processor.local.enqueue({ type: "clear" });
  await processor.process();
  assert.deepEqual(lastRemove(writer), [mine, theirs]);
  assert.equal(processor.model.size, 0);
});

test("the read facet has no own property beyond the collection's members", () => {
  const processor = new ShapeProcessor("me", new RefShapeWriter());
  const members = ["get", "size", "forEach", "compareZ", "inRect", "atPoint", "on", "off"];
  // B's facet keeps the writer in an own property of its own; A's has only
  // ShapeCollection's members.
  assert.deepEqual(Object.keys(processor.model).filter((k) => !members.includes(k)), []);
});

test("a clear that removes nothing does not cost more as shapes pile up", async () => {
  /** The time to apply clears that know nothing, with shapes present. */
  const cost = async (shapes: number, clears: number): Promise<number> => {
    const processor = new ShapeProcessor("me", new SpyWriter());
    for (let i = 0; i < shapes; i++) {
      processor.local.enqueue({ type: "add", id: processor.newShapeId(), shape: aShape() });
    }
    await processor.process();
    const started = performance.now();
    // Another client's clears, each knowing nothing: its refSeq covers no
    // add of ours, since none of ours is acknowledged, and it has made no
    // add of its own.
    for (let i = 0; i < clears; i++) {
      processor.remote.enqueue({ type: "clear", clientId: "other", clientSeq: i, refSeq: i - 1, seq: i });
    }
    await processor.process();
    const elapsed = performance.now() - started;
    assert.equal(processor.model.size, shapes);
    return elapsed;
  };
  await cost(50, 200); // warm up
  const few = await cost(20, 4000);
  const many = await cost(2000, 4000);
  // A walks every present shape for each clear, so a hundredfold more
  // shapes costs about a hundredfold more; B walks only what it removes,
  // which is nothing. The floor keeps a tiny measurement of few, and the
  // noise in it, from deciding the test.
  const bound = Math.max(few, 1) * 20;
  assert.ok(many < bound, `${many} ms with 2000 shapes against ${few} ms with 20`);
});
