// Adversary: a second dispose disposes the parts again.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("dispose-twice"));
