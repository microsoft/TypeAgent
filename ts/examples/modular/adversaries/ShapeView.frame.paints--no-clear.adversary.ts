// Adversary: frame draws over the last frame without clearing.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("no-clear"));
