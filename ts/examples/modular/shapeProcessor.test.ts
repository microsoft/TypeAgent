import { ShapeProcessor } from "./shapeProcessor.ts";
import { shapeMessageProcessorContract } from "./shapeModel.contract.ts";
import { RefShapeWriter } from "./shapewriterkit.ts";
import { testCircle } from "./viewkit.ts";
import { kitView } from "./shapeviewkit.ts";
import { RefDistributor } from "./distributorkit.ts";
import { RefCircles } from "./circleskit.ts";
import { scenarioContract } from "./scenario.contract.ts";
import { makeFixture } from "./driver.ts";
import { demoSettings } from "./scenarios.ts";

// Over the writer double, so that these tests depend on no other generated
// implementation. shapeModel.integration.test.ts wires the real writer.
shapeMessageProcessorContract((clientId) => new ShapeProcessor(clientId, new RefShapeWriter()));

// The scenarios, with every other part a test double. This task never sees the reference for its own part, so there is no comparison with the reference assembly here.
scenarioContract(() => makeFixture({
  processor: (clientId) => new ShapeProcessor(clientId, new RefShapeWriter()),
  makeCircle: testCircle,
  view: kitView,
  distributor: (region, locate) => new RefDistributor(region, locate),
  app: (parts) => new RefCircles(parts),
}, demoSettings));
