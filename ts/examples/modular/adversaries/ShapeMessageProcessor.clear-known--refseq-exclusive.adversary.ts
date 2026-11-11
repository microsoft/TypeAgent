// Adversary: A clear knows acknowledged adds with seq below its refSeq, not at it.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "refseq-exclusive"));
