// Adversary: every render makes new elements, so focus and drags are lost.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("rebuilds"));
