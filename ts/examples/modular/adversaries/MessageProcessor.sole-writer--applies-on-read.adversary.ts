// Adversary: Reading the model first applies whatever is queued.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

shapeMessageProcessorContract((id) => new TestShapeProcessor(id, "applies-on-read"));
