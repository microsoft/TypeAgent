// Adversary: each change adds the view's listener again.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("relistens-on-change"));
