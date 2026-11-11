// Adversary: On returns undefined, so calls can't be chained.
import { eventEmitterContract } from "../eventEmitter.contract.ts";
import { makeTestEvents } from "./_events.ts";

eventEmitterContract(makeTestEvents("on-returns-nothing"));
