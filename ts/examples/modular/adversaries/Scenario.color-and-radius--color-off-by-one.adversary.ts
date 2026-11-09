// Adversary: the chrome picks the next color. Every other part is the reference.
import { scenarioContract } from "../scenario.contract.ts";
import { kitDriver } from "../scenariokit.ts";
import { makeTestChrome } from "./_chrome.ts";

scenarioContract(() => kitDriver({ chrome: makeTestChrome("color-off-by-one") }), () => kitDriver());
