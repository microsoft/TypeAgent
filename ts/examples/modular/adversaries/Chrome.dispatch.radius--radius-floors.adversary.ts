// Adversary: set-value rounds down to a step instead of to the nearest.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("radius-floors"));
