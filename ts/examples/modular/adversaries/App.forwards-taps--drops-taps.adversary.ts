// Adversary: view taps aren't passed on.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("drops-taps"));
