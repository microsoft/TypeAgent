// Adversary: an up with no press in progress goes nowhere.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("stray-up-dropped"));
