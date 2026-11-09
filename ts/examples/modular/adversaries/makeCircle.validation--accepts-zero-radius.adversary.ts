// Adversary: makeCircle accepts a radius of 0.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("accepts-zero-radius"));
