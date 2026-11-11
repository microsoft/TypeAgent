// Adversary: newShapeId joins the clientId and a counter with no separator, so clients "a" and "a1" both make "a11".
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "ids-no-separator"));
