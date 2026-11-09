// Adversary: the router leaves points in window coordinates, so a tap on the view lands a toolbar's height too low. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestRoot } from "./_router.ts";

scenarioContract(() => kitDriver({ root: makeTestRoot("window-points") }), () => kitDriver());
