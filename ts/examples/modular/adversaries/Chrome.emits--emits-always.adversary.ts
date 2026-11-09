// Adversary: every dispatch emits change, even when nothing changed.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("emits-always"));
