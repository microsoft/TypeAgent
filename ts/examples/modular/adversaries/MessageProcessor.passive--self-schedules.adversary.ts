// Adversary: Enqueue schedules process itself.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

shapeMessageProcessorContract((id) => new TestShapeProcessor(id, "self-schedules"));
