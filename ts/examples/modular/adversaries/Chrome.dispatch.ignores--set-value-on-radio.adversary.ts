// Adversary: set-value on a radio acts like activating it.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("set-value-on-radio"));
