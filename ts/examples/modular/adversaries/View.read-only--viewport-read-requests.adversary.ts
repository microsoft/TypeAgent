// Adversary: Reading viewport requests a frame, to be safe.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("viewport-read-requests"));
