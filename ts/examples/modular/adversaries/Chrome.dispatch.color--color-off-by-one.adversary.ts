// Adversary: activating color.<i> sets the next color.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("color-off-by-one"));
