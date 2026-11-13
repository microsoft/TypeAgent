// Adversary: contains compares squared distances, which round differently at the boundary.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("contains-squared"));
