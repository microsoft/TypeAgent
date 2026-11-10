// Adversary: A group change marks the view but requests no frame.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("no-request-on-change"));
