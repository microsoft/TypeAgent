// Adversary: Choosing a color picks the next one. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitFixture({ app: makeTestCircles("color-off-by-one") }), () => kitFixture());
