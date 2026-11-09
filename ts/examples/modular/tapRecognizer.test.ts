import { tapRecognizerContract } from "./tapRecognizer.contract.ts";
import { RegionTaps } from "./tapRecognizer.ts";
import { ListLayer, testCircle } from "./viewkit.ts";
import { RefChrome } from "./chromekit.ts";
import { kitView } from "./shapeviewkit.ts";
import { TreeRenderer } from "./uikit.ts";
import { kitConnect } from "./appkit.ts";
import { RefRootRegion } from "./routerkit.ts";
import { scenarioContract } from "./scenario.contract.ts";
import { makeDriver } from "./driver.ts";
import { demoOptions, demoSize } from "./scenarios.ts";

tapRecognizerContract((region, slop) => new RegionTaps(region, slop));

// The scenarios, with every other part a test double. This task never sees the reference for its own part, so the comparison with the reference assembly runs in app.integration.test.ts.
scenarioContract(() => makeDriver({
  layer: () => new ListLayer(),
  makeCircle: testCircle,
  chrome: (layer, options, makeCircle) => new RefChrome(layer, options, makeCircle),
  view: kitView,
  renderer: () => new TreeRenderer(),
  connect: kitConnect,
  root: (width, height) => new RefRootRegion(width, height),
  taps: (region, slop) => new RegionTaps(region, slop),
}, demoOptions, demoSize));
