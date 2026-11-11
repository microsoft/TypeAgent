// Adversary: process takes remote first; an ack whose operation is still queued is applied as a remote add, then the operation is applied again.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "remote-first-twice"));
