// Adversary: The app erases the bottom circle at the point. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitFixture({ app: makeTestCircles("erases-bottom") }), () => kitFixture());
