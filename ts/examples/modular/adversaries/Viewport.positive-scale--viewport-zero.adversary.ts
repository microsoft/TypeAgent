// Adversary: Viewport reads as all zeros, a viewport never initialized.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("viewport-zero"));
