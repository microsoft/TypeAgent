// Adversary: the chrome listens to its layer twice.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("listens-twice"));
