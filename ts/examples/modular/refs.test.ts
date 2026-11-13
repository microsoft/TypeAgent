// The phase 3 reference adapters (*.ref.ts) must pass the contracts their
// tasks' outputs pass, wired the same way; otherwise their vote on a
// distinguishing test means nothing.
import { MapShapeCollection } from "./mapShapeCollection.ref.ts";
import { ShapeProcessor } from "./shapeProcessor.ref.ts";
import { makeCircle } from "./circle.ref.ts";
import { CanvasShapeView } from "./canvasShapeView.ref.ts";
import { shapeCollectionWriterContract, shapeMessageProcessorContract } from "./shapeModel.contract.ts";
import { circleContract } from "./circle.contract.ts";
import { shapeViewContract } from "./shapeView.contract.ts";
import { ListIndex } from "./modelkit.ts";
import { RefShapeWriter } from "./shapewriterkit.ts";
import { RecordingContext } from "./viewkit.ts";

shapeCollectionWriterContract(() => new MapShapeCollection(new ListIndex()));
shapeMessageProcessorContract((clientId) => new ShapeProcessor(clientId, new RefShapeWriter()));
circleContract(makeCircle);
shapeViewContract((model, scheduler, width, height) => {
  const recording = new RecordingContext(width, height);
  return { view: new CanvasShapeView(model, recording.context, scheduler), painted: (p) => recording.painted(p) };
});
