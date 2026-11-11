// Adversary: An emit calls the most recent registration first.
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { makeTestEvents } from "./_events.ts";

eventEmitterContract(makeTestEvents("emit-newest-first"));
