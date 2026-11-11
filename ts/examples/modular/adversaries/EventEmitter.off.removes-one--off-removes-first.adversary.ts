// Adversary: Off removes the earliest registration rather than the most recent.
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { makeTestEvents } from "./_events.ts";

eventEmitterContract(makeTestEvents("off-removes-first"));
