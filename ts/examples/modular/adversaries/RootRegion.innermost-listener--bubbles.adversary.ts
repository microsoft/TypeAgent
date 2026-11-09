// Adversary: ancestors with a listener get the event too.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("bubbles"));
