// Adversary: A rectangle is empty only when its width or height is 0, not when x + width rounds back to x.
import { rectangleOpsContract } from "../rectangleOps.contract.ts";
import { makeTestRectOps } from "./_rectOps.ts";

rectangleOpsContract(makeTestRectOps("empty-by-width"));
