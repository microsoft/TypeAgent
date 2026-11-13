// Adversary: intersects treats r as empty only when its width or height is 0, and skips the box check.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("empty-by-width"));
