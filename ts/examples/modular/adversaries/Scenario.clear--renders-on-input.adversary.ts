// Adversary: the app renders only after input, so the status doesn't follow taps. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestApp } from "./_app.ts";

scenarioContract(() => kitDriver({ connect: makeTestApp("renders-on-input") }), () => kitDriver());
