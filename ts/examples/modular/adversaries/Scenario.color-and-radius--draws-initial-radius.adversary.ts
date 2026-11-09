// Adversary: the chrome draws with the initial radius. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestChrome } from "./_chrome.ts";

scenarioContract(() => kitDriver({ chrome: makeTestChrome("draws-initial-radius") }), () => kitDriver());
