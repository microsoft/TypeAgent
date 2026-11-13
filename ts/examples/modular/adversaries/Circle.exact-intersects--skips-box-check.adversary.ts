// Adversary: intersects skips the bounding-box check and decides by a recomputed distance alone.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("skips-box-check"));
