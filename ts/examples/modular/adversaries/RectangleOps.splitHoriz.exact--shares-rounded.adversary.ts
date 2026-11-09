// Adversary: shares are rounded to nearest, so they may not add up to the width.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("shares-rounded"));
