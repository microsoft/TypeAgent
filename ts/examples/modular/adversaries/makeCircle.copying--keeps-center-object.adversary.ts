// Adversary: makeCircle keeps the caller's center object.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("keeps-center-object"));
