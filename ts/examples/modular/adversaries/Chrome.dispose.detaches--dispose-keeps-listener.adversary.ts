// Adversary: dispose leaves the layer listener.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("dispose-keeps-listener"));
