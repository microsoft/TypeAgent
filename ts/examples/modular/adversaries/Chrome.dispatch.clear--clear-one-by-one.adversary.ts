// Adversary: clear removes each item with remove.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("clear-one-by-one"));
