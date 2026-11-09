// Adversary: The bounding box is grown by the diameter, not the radius.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("box-uses-diameter"));
