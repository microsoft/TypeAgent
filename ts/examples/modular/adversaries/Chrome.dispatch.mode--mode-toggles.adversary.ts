// Adversary: activating either mode radio toggles the mode.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("mode-toggles"));
