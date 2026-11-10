// Adversary: Contains remembers its last point in a field of the circle.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("caches-on-shape"));
