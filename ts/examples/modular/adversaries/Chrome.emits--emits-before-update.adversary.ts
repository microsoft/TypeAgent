// Adversary: change is emitted before the state is updated.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("emits-before-update"));
