// Adversary: the app renders after passing on input, not when the chrome changes, so taps and outside edits aren't shown.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("renders-on-input"));
