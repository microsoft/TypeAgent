// Adversary: dispose leaves the tap listener, and taps are still passed on.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("taps-after-dispose"));
