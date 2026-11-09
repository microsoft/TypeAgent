// Adversary: slider values are set with the value attribute, which a browser ignores once the user has moved the slider.
import { rendererContract } from "../ui.contract.ts";
import { makeTestWeb } from "./_webRenderer.ts";

rendererContract(makeTestWeb("value-attribute"));
