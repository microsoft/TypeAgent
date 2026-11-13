// Adversary: The app always draws with the initial radius. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitDriver({ app: makeTestCircles("draws-initial-radius") }), () => kitDriver());
