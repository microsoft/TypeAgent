// Adversary: left and top are window coordinates, not relative to the parent.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("absolute-bounds"));
