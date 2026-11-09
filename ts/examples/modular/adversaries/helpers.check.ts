// The helpers that adversaries are built from, with no bug switched on, must pass
// their contracts; otherwise a caught adversary proves nothing. npm run adversaries
// runs this first.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { layerContract } from "../layer.contract.ts";
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ListLayer, RecordingContext, testCircle } from "../viewkit.ts";
import { kitView } from "../shapeviewkit.ts";
import { ListCollection, ListIndex } from "../modelkit.ts";
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";
import { routerContract } from "../pointer.contract.ts";
import { RefRootRegion } from "../routerkit.ts";
import { makeTestRoot } from "./_router.ts";
import { tapRecognizerContract } from "../tapRecognizer.contract.ts";
import { RefTaps as KitTaps } from "../tapkit.ts";
import { makeTestTaps } from "./_taps.ts";
import { chromeContract } from "../chrome.contract.ts";
import { RefChrome } from "../chromekit.ts";
import { makeTestChrome } from "./_chrome.ts";
import { rendererContract } from "../ui.contract.ts";
import { TreeRenderer } from "../uikit.ts";
import { makeTestWeb } from "./_webRenderer.ts";
import { appContract } from "../app.contract.ts";
import { kitConnect } from "../appkit.ts";
import { makeTestApp } from "./_app.ts";
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { TestCollection, TestLayer } from "./_layer.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("none"));
shapeCollectionContract(() => new TestCollection());
layerContract(() => new TestLayer());
circleContract(makeTestCircle());
shapeViewContract(makeTestView());
// The view contract's own doubles.
layerContract(() => new ListLayer());
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

// The reference chrome.
chromeContract((layer, options, makeCircle) => new RefChrome(layer, options, makeCircle));
chromeContract(makeTestChrome());

// The renderers.
rendererContract(() => new TreeRenderer());
rendererContract(makeTestWeb());

// The reference app.
appContract(kitConnect);
appContract(makeTestApp());

// The scenarios, on the reference assembly: a scenario that fails here disagrees with the rules.
scenarioContract(() => kitDriver(), () => kitDriver());

// The reference rectangle operations.
rectangleOpsContract(makeTestRectOps());

// The routers.
routerContract((w, h) => new RefRootRegion(w, h));
routerContract(makeTestRoot());

// The tap recognizers.
tapRecognizerContract((region, slop) => new KitTaps(region, slop));
tapRecognizerContract(makeTestTaps());
