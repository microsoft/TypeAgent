// Adversary: taps draw with the initial radius, not the current one.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("draws-initial-radius"));
