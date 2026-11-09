// Adversary: dispose leaves the app's listeners on its parts.
import { appContract } from "../app.contract.ts";
import { makeTestApp } from "./_app.ts";

appContract(makeTestApp("dispose-keeps-listeners"));
