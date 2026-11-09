// Adversary: cutting the right edge takes the strip from the left.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("cut-right-from-left"));
