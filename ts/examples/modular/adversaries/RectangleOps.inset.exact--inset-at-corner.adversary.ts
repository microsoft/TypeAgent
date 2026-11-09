// Adversary: an inset too large for the rectangle is placed at the corner, not the center.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("inset-at-corner"));
