// Adversary: a cut larger than the rectangle leaves a negative rest.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("cut-unclamped"));
