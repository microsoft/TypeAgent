// Adversary: a fraction of a unit goes to the first share.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("fraction-to-first"));
