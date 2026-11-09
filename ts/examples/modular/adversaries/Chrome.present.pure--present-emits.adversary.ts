// Adversary: present emits change.
import { chromeContract } from "../chrome.contract.ts";
import { makeTestChrome } from "./_chrome.ts";

chromeContract(makeTestChrome("present-emits"));
