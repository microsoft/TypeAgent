// Adversary: the view is left not interactive.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("not-interactive"));
