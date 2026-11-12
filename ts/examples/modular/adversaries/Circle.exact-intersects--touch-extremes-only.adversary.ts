// Adversary: An exact touch checks r's excluded edges only at the circle's four extremes, not at r's corners.
import { circleContract } from "../circle.contract.ts";
import { makeTestCircle } from "./_circle.ts";

circleContract(makeTestCircle("touch-extremes-only"));
