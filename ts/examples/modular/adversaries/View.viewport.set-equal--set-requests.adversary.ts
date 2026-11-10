// Adversary: Setting the viewport requests a frame even when the value is unchanged.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("set-requests"));
