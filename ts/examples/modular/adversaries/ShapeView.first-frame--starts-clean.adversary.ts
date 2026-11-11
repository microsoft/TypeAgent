// Adversary: The view draws only when dirty, and the flag starts false, so the first frame doesn't show a model that already has shapes.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeDirtyView } from "./_1b-view.ts";

shapeViewContract(makeDirtyView("starts-clean"));
