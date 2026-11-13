// Adversary: Clear leaves the top circle. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitDriver({ app: makeTestCircles("clear-keeps-top") }), () => kitDriver());
