// The reference app assembly: every part a test double, for running
// scenarios before any implementation exists and as the reference that
// random sequences are compared with. helpers.check.ts runs the scenarios on
// it. It reads every reference part, so only tasks whose own part has no
// reference here may import it (impl-specs.md, Hidden fields).

import type { AppMakers, Driver } from "./driver.ts";
import { makeDriver } from "./driver.ts";
import { demoOptions, demoSize } from "./scenarios.ts";
import { ListLayer, testCircle } from "./viewkit.ts";
import { kitView } from "./shapeviewkit.ts";
import { TreeRenderer } from "./uikit.ts";
import { RefChrome } from "./chromekit.ts";
import { kitConnect } from "./appkit.ts";
import { RefRootRegion } from "./routerkit.ts";
import { RefTaps } from "./tapkit.ts";

export const kitMakers: AppMakers = {
  layer: () => new ListLayer(),
  makeCircle: testCircle,
  chrome: (layer, options, makeCircle) => new RefChrome(layer, options, makeCircle),
  view: kitView,
  renderer: () => new TreeRenderer(),
  connect: kitConnect,
  root: (width, height) => new RefRootRegion(width, height),
  taps: (region, slop) => new RefTaps(region, slop),
};

/** A driver for an app assembled from kitMakers, with any parts replaced. */
export const kitDriver = (replace: Partial<AppMakers> = {}): Driver =>
  makeDriver({ ...kitMakers, ...replace }, demoOptions, demoSize);
