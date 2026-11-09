// Adversary: present shows the count from before the last change.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("status-stale"));
