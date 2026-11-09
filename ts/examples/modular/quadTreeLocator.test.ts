import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShapeId } from "./shape.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { shapeLocatorContract } from "./shapeLocator.contract.ts";

shapeLocatorContract(() => new QuadTreeLocator());

test("QuadTreeLocator.add.duplicate-throws", () => {
  const locator = new QuadTreeLocator();
  const box = { kind: "box", boundingBox: () => ({ x: 0, y: 0, width: 1, height: 1 }), contains: () => true, intersects: () => true };
  locator.add(1 as ShapeId, box);
  assert.throws(() => locator.add(1 as ShapeId, box), Error);
});
