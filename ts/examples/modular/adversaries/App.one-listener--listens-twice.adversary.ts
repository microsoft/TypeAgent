// Adversary: the app listens to the view's taps twice.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("listens-twice"));
