// Adversary: A clear removes every present shape except this client's pending adds, ignoring refSeq.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "clear-ignores-refseq"));
