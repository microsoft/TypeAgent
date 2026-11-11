// Adversary: A clear counts only acknowledged adds up to its refSeq as known, forgetting its client's own earlier adds.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { TestShapeProcessor } from "./_shapeModel.ts";

shapeMessageProcessorContract((id) => new TestShapeProcessor(id, "forgets-own-pending"));
