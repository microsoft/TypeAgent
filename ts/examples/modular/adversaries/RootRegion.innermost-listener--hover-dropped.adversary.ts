// Adversary: moves with no press go nowhere.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("hover-dropped"));
