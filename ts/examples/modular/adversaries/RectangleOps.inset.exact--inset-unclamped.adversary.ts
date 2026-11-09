// Adversary: inset can make a negative size.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("inset-unclamped"));
