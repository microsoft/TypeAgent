// Adversary: a press no region received is routed by position.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("uncaptured-routes"));
