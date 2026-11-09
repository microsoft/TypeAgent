// Adversary: moves and ups during a press are routed by position.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("no-capture"));
