// Adversary: The app never registers for taps, so they go nowhere. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitFixture({ app: makeTestCircles("drops-taps") }), () => kitFixture());
