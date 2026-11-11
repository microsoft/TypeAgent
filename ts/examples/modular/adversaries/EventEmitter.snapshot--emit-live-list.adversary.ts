// Adversary: An emit walks the live list, so listeners added during it are called and removed ones aren't.
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { makeTestEvents } from "./_events.ts";

eventEmitterContract(makeTestEvents("emit-live-list"));
