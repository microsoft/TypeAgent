import { scenarioContract } from "./scenario.contract.ts";
import { kitDriver } from "./scenariokit.ts";
import { webFixture } from "./domkit.ts";
import { RecordingContext } from "./viewkit.ts";
import { MapShapeCollection } from "./mapShapeCollection.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { ShapeLayer } from "./shapeLayer.ts";
import { makeCircle } from "./circle.ts";
import { ChromeModel } from "./chromeModel.ts";
import { CanvasShapeView } from "./canvasShapeView.ts";
import { WebRenderer } from "./webRenderer.ts";
import { connectApp } from "./connectApp.ts";
import { RegionRouter } from "./regionRouter.ts";
import { RegionTaps } from "./tapRecognizer.ts";

// Every part real, compared with the reference assembly. Part of no
// generation task: it runs once all of them exist.
scenarioContract(() => kitDriver({
  layer: () => new ShapeLayer(new MapShapeCollection(), new QuadTreeLocator()),
  makeCircle,
  chrome: (layer, options, make) => new ChromeModel(layer, options, make),
  view: (scene, scheduler, taps, width, height) => {
    const recording = new RecordingContext(width, height);
    return { view: new CanvasShapeView(scene, recording.context, scheduler, taps), painted: (p) => recording.painted(p) };
  },
  renderer: () => webFixture((doc, container) => new WebRenderer(doc, container)),
  connect: connectApp,
  root: (width, height) => new RegionRouter(width, height),
  taps: (region, slop) => new RegionTaps(region, slop),
}), () => kitDriver());
