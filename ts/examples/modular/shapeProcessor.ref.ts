// The reference for task 9 in phase 3: ShapeProcessor's constructor over
// RefShapeProcessor.

import type { ShapeCollectionWriter } from "./shapeModel.ts";
import { RefShapeProcessor } from "./shapeprocessorkit.ts";

export class ShapeProcessor extends RefShapeProcessor {
  constructor(clientId: string, writer: ShapeCollectionWriter) {
    super(clientId, writer);
  }
}
