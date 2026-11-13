// Adversary: The app uses a tap as it is in the window, so circles land a controls-height too low. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitDriver({ app: makeTestCircles("window-points") }), () => kitDriver());
