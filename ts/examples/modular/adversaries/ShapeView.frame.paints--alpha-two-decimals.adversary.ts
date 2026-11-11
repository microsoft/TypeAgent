// Adversary: fillStyle's alpha is written with toFixed(2), so alpha 1/3 is drawn as 0.33.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeDirtyView } from "./_1b-view.ts";

shapeViewContract(makeDirtyView("alpha-two-decimals"));
