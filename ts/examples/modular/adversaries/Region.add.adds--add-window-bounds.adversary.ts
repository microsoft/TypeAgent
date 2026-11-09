// Adversary: a nested region's bounds are kept in window coordinates, not its parent's.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("add-window-bounds"));
