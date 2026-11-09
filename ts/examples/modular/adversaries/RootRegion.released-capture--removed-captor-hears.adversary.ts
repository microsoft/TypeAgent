// Adversary: a removed region that captured the press still gets the press's events.
import { routerContract } from "../pointer.contract.ts";
import { makeTestRoot } from "./_router.ts";

routerContract(makeTestRoot("removed-captor-hears"));
