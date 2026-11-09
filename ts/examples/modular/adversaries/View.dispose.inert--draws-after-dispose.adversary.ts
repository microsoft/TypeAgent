// Adversary: A frame requested before dispose still draws.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("draws-after-dispose"));
