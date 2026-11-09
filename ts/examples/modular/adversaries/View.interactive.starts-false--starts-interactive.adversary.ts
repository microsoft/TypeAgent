// Adversary: a new view is interactive.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("starts-interactive"));
