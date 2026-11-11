// Adversary: An acknowledgment is recognized by clientSeq alone, so another client's operation with the same clientSeq is dropped.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "ack-by-client-seq"));
