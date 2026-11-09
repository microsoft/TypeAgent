// Adversary: right and bottom edges count as inside a region.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("edge-inclusive"));
