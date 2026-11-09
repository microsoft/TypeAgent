// Adversary: the chrome erases the bottom circle at the point. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestChrome } from "./_chrome.ts";

scenarioContract(() => kitDriver({ chrome: makeTestChrome("erases-bottom") }), () => kitDriver());
