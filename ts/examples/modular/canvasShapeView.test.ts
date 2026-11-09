import { CanvasShapeView } from "./canvasShapeView.ts";
import { shapeViewContract } from "./shapeView.contract.ts";
import { RecordingContext } from "./viewkit.ts";
import { ListLayer, testCircle } from "./viewkit.ts";
import { RefChrome } from "./chromekit.ts";
import { TreeRenderer } from "./uikit.ts";
import { kitConnect } from "./appkit.ts";
import { RefRootRegion } from "./routerkit.ts";
import { RefTaps } from "./tapkit.ts";
import { scenarioContract } from "./scenario.contract.ts";
import { makeDriver } from "./driver.ts";
import { demoOptions, demoSize } from "./scenarios.ts";

shapeViewContract((scene, scheduler, taps, width, height) => {
  const recording = new RecordingContext(width, height);
  return { view: new CanvasShapeView(scene, recording.context, scheduler, taps), painted: (p) => recording.painted(p) };
});

// The scenarios, with every other part a test double. This task never sees the reference for its own part, so the comparison with the reference assembly runs in app.integration.test.ts.
scenarioContract(() => makeDriver({
  layer: () => new ListLayer(),
  makeCircle: testCircle,
  chrome: (layer, options, makeCircle) => new RefChrome(layer, options, makeCircle),
  view: (scene, scheduler, taps, width, height) => {
    const recording = new RecordingContext(width, height);
    return { view: new CanvasShapeView(scene, recording.context, scheduler, taps), painted: (p) => recording.painted(p) };
  },
  renderer: () => new TreeRenderer(),
  connect: kitConnect,
  root: (width, height) => new RefRootRegion(width, height),
  taps: (region, slop) => new RefTaps(region, slop),
}, demoOptions, demoSize));
