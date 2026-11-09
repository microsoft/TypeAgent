// Adversary: each change of the chrome renders twice.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("renders-twice"));
