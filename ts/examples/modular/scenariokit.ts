// The reference app assembly: every part a reference, for running
// scenarios before any implementation exists and as the reference that
// random sequences are compared with. helpers.check.ts runs the scenarios on
// it. It reads every reference, so only tasks whose own part has no
// reference here may import it (impl-specs.md, Hidden fields).

import type { AppMakers } from "./driver.ts";
import type { Driver } from "./scenario.contract.ts";
import { makeDriver } from "./driver.ts";
import { demoSettings } from "./scenarios.ts";
import { testCircle } from "./viewkit.ts";
import { RefShapeProcessor } from "./shapeprocessorkit.ts";
import { kitView } from "./shapeviewkit.ts";
import { RefDistributor } from "./distributorkit.ts";
import { RefCircles } from "./circleskit.ts";

export const kitMakers: AppMakers = {
  processor: (clientId) => new RefShapeProcessor(clientId),
  makeCircle: testCircle,
  view: kitView,
  distributor: (region, locate) => new RefDistributor(region, locate),
  app: (parts) => new RefCircles(parts),
};

/** A driver for an app assembled from kitMakers, with any parts replaced. */
export const kitDriver = (replace: Partial<AppMakers> = {}): Driver =>
  makeDriver({ ...kitMakers, ...replace }, demoSettings);
