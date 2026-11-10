// The helpers that adversaries are built from, with no bug switched on, must pass
// their contracts; otherwise a caught adversary proves nothing. npm run adversaries
// runs this first.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { renderGroupContract } from "../renderGroup.contract.ts";
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ListGroup, ManualScheduler, RecordingContext, testCircle } from "../viewkit.ts";
import { frameSchedulerContract } from "../frameScheduler.contract.ts";
import { makeTestScheduler } from "./_scheduler.ts";
import { kitView } from "../shapeviewkit.ts";
import { ListCollection, ListIndex } from "../modelkit.ts";
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { RefDistributor } from "../distributorkit.ts";
import { makeTestDistributor } from "./_distributor.ts";
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";
import { TestCollection, TestGroup } from "./_group.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("none"));
shapeCollectionContract(() => new TestCollection());
renderGroupContract(() => new TestGroup());
circleContract(makeTestCircle());
shapeViewContract(makeTestView());
// The view contract's own doubles.
renderGroupContract(() => new ListGroup());
circleContract(testCircle);
shapeViewContract(kitView);
// The model doubles.
shapeCollectionContract(() => new ListCollection());
shapeLocatorContract(() => new ListIndex());

test("RecordingContext.context allows only DrawingContext's members", () => {
  const recording = new RecordingContext(4, 4);
  const context = recording.context as unknown as Record<string, unknown> & { canvas: Record<string, unknown> };
  context.fillStyle = "rgba(0, 0, 0, 1)";
  recording.context.clearRect(0, 0, 4, 4);
  assert.equal(context.canvas.width, 4);
  assert.throws(() => context.fillRect, /DrawingContext \(canvas\.ts\) lacks/);
  assert.throws(() => context.painted, /lacks/);
  assert.throws(() => { context.strokeStyle = "red"; }, /lacks/);
  assert.throws(() => context.canvas.getContext, /DrawingContext\.canvas/);
});

// The scenarios, on the reference app and on the adversaries' helper: a scenario that fails here disagrees with itself.
scenarioContract(() => kitFixture(), () => kitFixture());
scenarioContract(() => kitFixture({ app: makeTestCircles() }), () => kitFixture());

// The reference rectangle operations.
rectangleOpsContract(makeTestRectOps());

// The schedulers: the one every view test steps by hand, and the adversaries' helper.
frameSchedulerContract(() => {
  const scheduler = new ManualScheduler();
  return { scheduler, runFrame: () => scheduler.runFrame() };
});
frameSchedulerContract(makeTestScheduler());

// The event distributors.
eventDistributorContract((region, locate) => new RefDistributor(region, locate));
eventDistributorContract(makeTestDistributor());
