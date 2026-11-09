// Adversary: tap points are rounded to whole units.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("tap-rounded"));
