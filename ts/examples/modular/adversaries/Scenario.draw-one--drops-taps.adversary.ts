// Adversary: The app never registers for taps, so they go nowhere. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitDriver({ app: makeTestCircles("drops-taps") }), () => kitDriver());
