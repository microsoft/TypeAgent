import { CanvasShapeView } from "./canvasShapeView.ts";
import { shapeViewContract } from "./shapeView.contract.ts";
import { RecordingContext, testCircle } from "./viewkit.ts";
import { RefShapeProcessor } from "./shapeprocessorkit.ts";
import { RefDistributor } from "./distributorkit.ts";
import { RefCircles } from "./circleskit.ts";
import { scenarioContract } from "./scenario.contract.ts";
import { makeFixture } from "./driver.ts";
import { demoSettings } from "./scenarios.ts";

shapeViewContract((model, scheduler, width, height) => {
  const recording = new RecordingContext(width, height);
  return { view: new CanvasShapeView(model, recording.context, scheduler), painted: (p) => recording.painted(p) };
});

// The scenarios, with every other part a test double. This task never sees the reference for its own part, so there is no comparison with the reference assembly here.
scenarioContract(() => makeFixture({
  processor: (clientId) => new RefShapeProcessor(clientId),
  makeCircle: testCircle,
  view: (model, scheduler, width, height) => {
    const recording = new RecordingContext(width, height);
    return { view: new CanvasShapeView(model, recording.context, scheduler), painted: (p) => recording.painted(p) };
  },
  distributor: (region, locate) => new RefDistributor(region, locate),
  app: (parts) => new RefCircles(parts),
}, demoSettings));
