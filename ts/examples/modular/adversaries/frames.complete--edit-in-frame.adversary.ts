// Adversary: A tap's edit waits for the next frame. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestCircles } from "./_circles.ts";

scenarioContract(() => kitFixture({ app: makeTestCircles("edit-in-frame") }), () => kitFixture());
