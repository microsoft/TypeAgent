// Adversary: count follows only the chrome's own edits, not edits from elsewhere.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("counts-own-edits-only"));
