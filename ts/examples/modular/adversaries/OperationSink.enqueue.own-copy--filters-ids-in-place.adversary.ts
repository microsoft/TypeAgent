// Adversary: local enqueue returns a shallow copy, then applying a remove drops absent IDs from the shared ids array.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "filters-ids-in-place"));
