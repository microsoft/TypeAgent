// Adversary: Iterates the live registration list, so listeners' changes affect the call.
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { makeTestDistributor } from "./_distributor.ts";

eventDistributorContract(makeTestDistributor("live-list"));
