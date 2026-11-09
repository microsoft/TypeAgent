// Adversary: intersects is distance <= radius, so a disk that only touches r intersects it.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("touch-is-true"));
