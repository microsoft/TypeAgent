// Adversary: the app doesn't pass the view's taps to the chrome. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestApp } from "./_app.ts";

scenarioContract(() => kitDriver({ connect: makeTestApp("drops-taps") }), () => kitDriver());
