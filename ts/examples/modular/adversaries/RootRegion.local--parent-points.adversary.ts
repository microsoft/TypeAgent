// Adversary: points are offset by the region's own bounds only, not its ancestors'.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("parent-points"));
