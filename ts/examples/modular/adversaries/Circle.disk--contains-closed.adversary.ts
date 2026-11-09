// Adversary: contains ignores the half-open rule at the maximum x and y.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("contains-closed"));
