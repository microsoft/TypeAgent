// Adversary: Emits its own stamped operation, which acknowledging later changes.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

shapeMessageProcessorContract((id) => new TestShapeProcessor(id, "shares-op"));
