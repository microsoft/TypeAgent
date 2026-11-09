// Adversary: the innermost region at the point gets the event, or nobody if it has no listener.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("deepest-only"));
