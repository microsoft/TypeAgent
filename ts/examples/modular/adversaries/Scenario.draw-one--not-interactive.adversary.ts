// Adversary: the app leaves the view not interactive, so taps go nowhere. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestApp } from "./_app.ts";

scenarioContract(() => kitDriver({ connect: makeTestApp("not-interactive") }), () => kitDriver());
