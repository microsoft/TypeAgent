// Adversary: state returns the chrome's own object, which later changes alter.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("state-live"));
