// Adversary: A frame keeps running handlers until none is pending, so a request made during it runs in it.
import { frameSchedulerContract } from "../frameScheduler.contract.ts";
import { makeTestScheduler } from "./_scheduler.ts";

frameSchedulerContract(makeTestScheduler("live-pending"));
