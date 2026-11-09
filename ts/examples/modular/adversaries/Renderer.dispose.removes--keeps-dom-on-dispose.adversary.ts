// Adversary: dispose leaves the elements in place.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("keeps-dom-on-dispose"));
