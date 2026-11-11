// The helpers that adversaries are built from, with no bug switched on, must pass
// their contracts; otherwise a caught adversary proves nothing. npm run adversaries
// runs this first.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ManualScheduler, RecordingContext, testCircle } from "../viewkit.ts";
import { frameSchedulerContract } from "../frameScheduler.contract.ts";
import { makeTestScheduler } from "./_scheduler.ts";
import { kitView } from "../shapeviewkit.ts";
import { ListIndex } from "../modelkit.ts";
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { RefDistributor } from "../distributorkit.ts";
import { makeTestDistributor } from "./_distributor.ts";
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";
import { QuadTree } from "./_quadtree.ts";
import { shapeCollectionWriterContract, shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { RefShapeWriter } from "../shapewriterkit.ts";
import { RefShapeProcessor } from "../shapeprocessorkit.ts";
import { TestShapeProcessor, TestShapeWriter } from "./_shapeModel.ts";
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { Events } from "../eventkit.ts";
import { makeTestEvents } from "./_events.ts";

shapeLocatorContract(() => new QuadTree("none"));
circleContract(makeTestCircle());
shapeViewContract(makeTestView());
// The view contract's own doubles.
circleContract(testCircle);
shapeViewContract(kitView);
// The locator double.
shapeLocatorContract(() => new ListIndex());

// The emitters: the one test doubles are built on, and the adversaries' helper.
eventEmitterContract(() => {
  const emitter = new Events<{ change: [] }>();
  return { emitter, change: () => emitter.emit("change") };
});
eventEmitterContract(makeTestEvents());

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

// The shape model: the reference parts and the adversaries' helpers.
shapeCollectionWriterContract(() => new RefShapeWriter());
shapeMessageProcessorContract((id) => new RefShapeProcessor(id));
shapeCollectionWriterContract(() => new TestShapeWriter());
shapeMessageProcessorContract((id) => new TestShapeProcessor(id));
