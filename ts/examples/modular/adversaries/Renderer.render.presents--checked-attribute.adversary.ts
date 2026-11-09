// Adversary: radios get aria-selected instead of aria-checked.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("checked-attribute"));
