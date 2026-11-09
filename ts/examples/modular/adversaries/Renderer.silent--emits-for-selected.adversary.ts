// Adversary: activating a radio that is already selected emits.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("emits-for-selected"));
