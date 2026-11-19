// Adversary: The processor's writer already holds a shape when the processor starts.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { RefShapeProcessor } from "../shapeprocessorkit.ts";
import { RefShapeWriter } from "../shapewriterkit.ts";
import { makeCircle } from "../circle.ts";
import type { ShapeId } from "../shape.ts";

shapeMessageProcessorContract((id) => {
  const writer = new RefShapeWriter();
  const shape = makeCircle({ center: { x: 1, y: 1 }, radius: 1, color: { r: 0, g: 0, b: 0, a: 1 } });
  writer.add(`before-${id}` as ShapeId, shape, undefined);
  return new RefShapeProcessor(id, writer);
});
