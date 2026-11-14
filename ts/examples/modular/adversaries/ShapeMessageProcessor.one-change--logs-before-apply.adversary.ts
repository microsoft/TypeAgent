// Adversary: logOperations reports each operation before applying it, so its change comes after the report.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

shapeMessageProcessorContract((id) => new TestShapeProcessor(id, "logs-before-apply"));
