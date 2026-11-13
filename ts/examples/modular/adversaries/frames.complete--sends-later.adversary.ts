// Adversary: A tap sends its operation in a microtask, after its handler returns. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitDriver({ app: makeTestCircles("sends-later") }), () => kitDriver());
