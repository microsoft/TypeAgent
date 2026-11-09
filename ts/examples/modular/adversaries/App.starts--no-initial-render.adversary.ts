// Adversary: nothing is rendered until the chrome first changes.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("no-initial-render"));
