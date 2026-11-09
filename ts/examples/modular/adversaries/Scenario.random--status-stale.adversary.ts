// Adversary: the chrome's status shows the count from before the last change. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestChrome } from "./_chrome.ts";

scenarioContract(() => kitDriver({ chrome: makeTestChrome("status-stale") }), () => kitDriver());
