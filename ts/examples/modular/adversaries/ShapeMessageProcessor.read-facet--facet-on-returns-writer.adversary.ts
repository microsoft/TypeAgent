// Adversary: The model facet's on and off return the writer, so model.on(...).add(...) changes the shapes.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "facet-on-returns-writer"));
