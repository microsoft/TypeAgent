// Adversary: set-value only clamps the radius to the range.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("radius-unsnapped"));
