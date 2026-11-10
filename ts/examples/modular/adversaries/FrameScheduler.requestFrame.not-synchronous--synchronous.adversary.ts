// Adversary: requestFrame calls frame() at once.
import { frameSchedulerContract } from "../frameScheduler.contract.ts";
import { makeTestScheduler } from "./_scheduler.ts";

frameSchedulerContract(makeTestScheduler("synchronous"));
