// Adversary: An acknowledgment removes the shape and adds it again on top.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

shapeMessageProcessorContract((id) => new TestShapeProcessor(id, "ack-reapplies"));
