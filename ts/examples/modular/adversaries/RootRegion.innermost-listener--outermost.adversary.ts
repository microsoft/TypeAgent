// Adversary: the outermost region with a listener gets the event.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("outermost"));
