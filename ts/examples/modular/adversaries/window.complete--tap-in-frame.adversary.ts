// Adversary: the view holds a tap until the next frame and emits it from frame(). Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestView } from "./_view.ts";

scenarioContract(() => kitDriver({ view: makeTestView("tap-in-frame") }), () => kitDriver());
