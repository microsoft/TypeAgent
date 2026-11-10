// Adversary: A group change redraws at once, instead of in the next frame.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("draws-on-change"));
