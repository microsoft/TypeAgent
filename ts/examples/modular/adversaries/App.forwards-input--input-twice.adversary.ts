// Adversary: each input is dispatched twice.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("input-twice"));
