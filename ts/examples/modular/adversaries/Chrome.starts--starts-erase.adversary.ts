// Adversary: a new chrome is in erase mode.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("starts-erase"));
