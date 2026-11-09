// Adversary: buttons are disabled with aria-disabled only, which doesn't stop clicks, and clicks aren't checked.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("disabled-not-blocked"));
