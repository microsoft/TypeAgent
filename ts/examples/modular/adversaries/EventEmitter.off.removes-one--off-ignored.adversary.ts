// Adversary: Off does nothing.
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { makeTestEvents } from "./_events.ts";

eventEmitterContract(makeTestEvents("off-ignored"));
