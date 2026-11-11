// Adversary: Enqueue schedules process for the next frame, 16 ms later.
import { shapeMessageProcessorContract } from "../shapeModel.contract.ts";
import { FacetProcessor } from "./_1b-shapeModel.ts";

shapeMessageProcessorContract((id) => new FacetProcessor(id, "timer-process"));
