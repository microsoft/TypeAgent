// Adversary: Circles are drawn opaque.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("ignores-alpha"));
