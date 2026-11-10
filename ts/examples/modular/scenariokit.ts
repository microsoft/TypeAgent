// The reference app assembly: every part a test double, for running
// scenarios before any implementation exists and as the reference that
// random sequences are compared with. helpers.check.ts runs the scenarios on
// it. It reads every reference part, so only tasks whose own part has no
// reference here may import it (impl-specs.md, Hidden fields).

import type { AppMakers } from "./driver.ts";
import type { AppFixture } from "./scenario.contract.ts";
import { makeFixture } from "./driver.ts";
import { demoSettings } from "./scenarios.ts";
import { ListGroup, testCircle } from "./viewkit.ts";
import { kitView } from "./shapeviewkit.ts";
import { RefDistributor } from "./distributorkit.ts";
import { RefCircles } from "./circleskit.ts";

export const kitMakers: AppMakers = {
  group: () => new ListGroup(),
  makeCircle: testCircle,
  view: kitView,
  distributor: (region, locate) => new RefDistributor(region, locate),
  app: (parts) => new RefCircles(parts),
};

/** A fixture for an app assembled from kitMakers, with any parts replaced. */
export const kitFixture = (replace: Partial<AppMakers> = {}): AppFixture =>
  makeFixture({ ...kitMakers, ...replace }, demoSettings);
