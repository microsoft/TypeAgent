// Adversary: the web renderer marks radios with aria-selected instead of aria-checked. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestWeb } from "./_webRenderer.ts";

scenarioContract(() => kitDriver({ renderer: makeTestWeb("checked-attribute") }), () => kitDriver());
