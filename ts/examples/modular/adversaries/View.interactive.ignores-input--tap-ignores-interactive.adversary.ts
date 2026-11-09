// Adversary: taps are passed on even when the view isn't interactive.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("tap-ignores-interactive"));
