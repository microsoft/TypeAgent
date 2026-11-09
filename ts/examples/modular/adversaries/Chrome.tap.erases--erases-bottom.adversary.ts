// Adversary: erase removes the bottommost item at the point.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("erases-bottom"));
