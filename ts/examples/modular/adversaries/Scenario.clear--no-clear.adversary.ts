// Adversary: The view draws over its last frame without clearing it. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitFixture } from "../scenariokit.ts";
import { makeTestView } from "./_view.ts";

scenarioContract(() => kitFixture({ view: makeTestView("no-clear") }), () => kitFixture());
