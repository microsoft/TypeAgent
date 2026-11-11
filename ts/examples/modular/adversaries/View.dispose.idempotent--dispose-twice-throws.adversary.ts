// Adversary: A second dispose throws, as a guard against misuse.
import { shapeViewContract } from "../shapeView.contract.ts";
import { makeTestView } from "./_view.ts";

shapeViewContract(makeTestView("dispose-twice-throws"));
