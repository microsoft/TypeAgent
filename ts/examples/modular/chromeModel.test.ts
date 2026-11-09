import { chromeContract } from "./chrome.contract.ts";
import { ChromeModel } from "./chromeModel.ts";
import { ListLayer, testCircle } from "./viewkit.ts";
import { kitView } from "./shapeviewkit.ts";
import { TreeRenderer } from "./uikit.ts";
import { kitConnect } from "./appkit.ts";
import { RefRootRegion } from "./routerkit.ts";
import { RefTaps } from "./tapkit.ts";
import { scenarioContract } from "./scenario.contract.ts";
import { makeDriver } from "./driver.ts";
import { demoOptions, demoSize } from "./scenarios.ts";

chromeContract((layer, options, makeCircle) => new ChromeModel(layer, options, makeCircle));

// The scenarios, with every other part a test double. This task never sees the reference for its own part, so the comparison with the reference assembly runs in app.integration.test.ts.
scenarioContract(() => makeDriver({
  layer: () => new ListLayer(),
  makeCircle: testCircle,
  chrome: (layer, options, makeCircle) => new ChromeModel(layer, options, makeCircle),
  view: kitView,
  renderer: () => new TreeRenderer(),
  connect: kitConnect,
  root: (width, height) => new RefRootRegion(width, height),
  taps: (region, slop) => new RefTaps(region, slop),
}, demoOptions, demoSize));
