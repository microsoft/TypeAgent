// Adversary: the view draws over its last frame without clearing it. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestView } from "./_view.ts";

scenarioContract(() => kitDriver({ view: makeTestView("no-clear") }), () => kitDriver());
