// Adversary: the constructor adds its listener to each group twice.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("listens-twice"));
