// Adversary: The first process call also adds a shape that no operation made.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { RefShapeProcessor } from "../shapeprocessorkit.ts";
import { RefShapeWriter } from "../shapewriterkit.ts";
import { makeCircle } from "../circle.ts";
import type { ShapeId } from "../shape.ts";

class StrayShapeProcessor extends RefShapeProcessor {
  private readonly own: RefShapeWriter;
  private strayAdded = false;

  constructor(clientId: string) {
    const writer = new RefShapeWriter();
    super(clientId, writer);
    this.own = writer;
  }

  override async process(): Promise<void> {
    await super.process();
    if (this.strayAdded) return;
    this.strayAdded = true;
    const shape = makeCircle({ center: { x: 1, y: 1 }, radius: 1, color: { r: 0, g: 0, b: 0, a: 1 } });
    this.own.add(`stray-${this.clientId}` as ShapeId, shape, undefined);
  }
}

shapeMessageProcessorContract((id) => new StrayShapeProcessor(id));
