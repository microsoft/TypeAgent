// Adversary: Off for a listener with no registration removes the most recent one of any listener.
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { makeTestEvents } from "./_events.ts";

eventEmitterContract(makeTestEvents("off-absent-removes-another"));
