// Adversary: dispose leaves the view's listeners on the groups.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("dispose-keeps-listeners"));
