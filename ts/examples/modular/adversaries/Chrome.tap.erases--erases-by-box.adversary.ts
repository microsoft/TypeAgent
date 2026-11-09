// Adversary: erase removes the topmost item whose bounding box contains the point.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("erases-by-box"));
