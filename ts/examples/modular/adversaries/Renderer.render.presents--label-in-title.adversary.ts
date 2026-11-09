// Adversary: containers get a title attribute instead of aria-label.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("label-in-title"));
