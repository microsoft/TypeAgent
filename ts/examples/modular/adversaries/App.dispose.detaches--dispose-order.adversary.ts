// Adversary: dispose disposes the renderer first.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("dispose-order"));
