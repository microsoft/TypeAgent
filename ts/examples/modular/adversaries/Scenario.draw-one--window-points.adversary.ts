// Adversary: The app uses a tap as it is in the window, so circles land a controls-height too low. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitFixture({ app: makeTestCircles("window-points") }), () => kitFixture());
