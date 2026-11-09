// Adversary: Circles are drawn half a unit too large.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("radius-plus-half"));
