// Adversary: intersects answers from the bounding box alone.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("intersects-by-box"));
