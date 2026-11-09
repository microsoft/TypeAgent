// Adversary: frame draws each layer's items top first.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("items-reversed"));
