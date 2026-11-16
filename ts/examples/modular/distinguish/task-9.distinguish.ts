/**
 * Tells the two implementations of shapeProcessor.ts apart: each test here
 * passes on one of them and fails on the other, using only the interfaces
 * the spec names. Every call keeps the rules' @requires: IDs for local adds
 * come from newShapeId, remote operations arrive with growing seqs and in
 * each client's clientSeq order, and nothing enqueues or calls process
 * while a process call is pending.
 *
 * Imports: node:test, node:assert/strict, shapeProcessor.ts, shapewriterkit.ts,
 *   viewkit.ts, shapeModel.vocab.ts, shape.ts, shapeModel.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ShapeProcessor } from "./shapeProcessor.ts";
import { RefShapeWriter } from "./shapewriterkit.ts";
import { testCircle } from "./viewkit.ts";
import { collectionMembers } from "./shapeModel.vocab.ts";
import type { Shape, ShapeId } from "./shape.ts";
import type { ShapeOp } from "./shapeModel.ts";

const ink = { r: 0, g: 0, b: 255, a: 1 };

/** A small circle at x, far enough from the others to stay distinct. */
const dot = (x: number): Shape => testCircle({ center: { x, y: 0 }, radius: 1, color: ink });

test("a local remove applies the IDs it was given when it was enqueued", async () => {
  const writer = new RefShapeWriter();
  const p = new ShapeProcessor("c1", writer);
  const first = p.newShapeId();
  const second = p.newShapeId();
  p.local.enqueue({ type: "add", id: first, shape: dot(0) });
  p.local.enqueue({ type: "add", id: second, shape: dot(10) });
  await p.process();
  const ids: ShapeId[] = [first];
  p.local.enqueue({ type: "remove", ids });
  ids.push(second);
  await p.process();
  assert.equal(writer.size, 1);
  assert.ok(writer.get(second) !== undefined);
});

test("a remote remove applies the IDs it was given when it was enqueued", async () => {
  const writer = new RefShapeWriter();
  const p = new ShapeProcessor("c1", writer);
  const first = "peer#0" as ShapeId;
  const second = "peer#1" as ShapeId;
  p.remote.enqueue({ type: "add", id: first, shape: dot(0), clientId: "peer", clientSeq: 0, refSeq: -1, seq: 0 });
  p.remote.enqueue({ type: "add", id: second, shape: dot(10), clientId: "peer", clientSeq: 1, refSeq: -1, seq: 1 });
  await p.process();
  const ids: ShapeId[] = [first];
  p.remote.enqueue({ type: "remove", ids, clientId: "peer", clientSeq: 2, refSeq: 1, seq: 2 });
  ids.push(second);
  await p.process();
  assert.equal(writer.size, 1);
  assert.ok(writer.get(second) !== undefined);
});

test("applied reports the very object the remote queue was given", async () => {
  const p = new ShapeProcessor("c1", new RefShapeWriter());
  const op: ShapeOp = { type: "clear", clientId: "peer", clientSeq: 0, refSeq: -1, seq: 0 };
  const seen: ShapeOp[] = [];
  p.logOperations.on("applied", (logged) => void seen.push(logged));
  p.remote.enqueue(op);
  await p.process();
  assert.equal(seen.length, 1);
  assert.equal(seen[0], op);
});

test("the stamped operation keeps the property order of the content it was made from", async () => {
  const p = new ShapeProcessor("c1", new RefShapeWriter());
  const id = p.newShapeId();
  const stamped = p.local.enqueue({ shape: dot(0), id, type: "add" });
  await p.process();
  assert.deepEqual(Object.keys(stamped), ["shape", "id", "type", "clientId", "clientSeq", "refSeq", "seq"]);
});

test("the read facet carries ShapeCollection's members as its own properties", () => {
  const p = new ShapeProcessor("c1", new RefShapeWriter());
  const own = Reflect.ownKeys(p.model).map((key) => String(key));
  assert.deepEqual([...own].sort(), [...collectionMembers].sort());
});

test("the operation log keeps its registrations out of its own properties", () => {
  const p = new ShapeProcessor("c1", new RefShapeWriter());
  p.logOperations.on("applied", () => undefined);
  assert.deepEqual(Reflect.ownKeys(p.logOperations), []);
});

test("the read facet's on still works when it is called apart from the facet", () => {
  const p = new ShapeProcessor("c1", new RefShapeWriter());
  const on = p.model.on;
  const listener = () => undefined;
  assert.equal(on("change", listener), p.model);
});
