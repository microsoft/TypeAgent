// Adversary: Pending handlers are kept in a list, so a repeated request calls frame() twice.
import { frameSchedulerContract } from "../frameScheduler.contract.ts";
import { makeTestScheduler } from "./_scheduler.ts";

frameSchedulerContract(makeTestScheduler("list-not-set"));
