// Adversary: Registers for taps on the whole window, not the drawing's surface.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitDriver({ app: makeTestCircles("whole-window") }), () => kitDriver());
