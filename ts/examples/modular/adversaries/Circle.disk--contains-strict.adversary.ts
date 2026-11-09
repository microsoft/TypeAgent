// Adversary: contains leaves out points at exactly the radius.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("contains-strict"));
