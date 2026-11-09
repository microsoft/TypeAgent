// Adversary: render reports a slider whose value it changed.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("emits-on-render"));
