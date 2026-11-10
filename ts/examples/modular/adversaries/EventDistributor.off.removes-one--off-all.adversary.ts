// Adversary: Off removes every matching registration.
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { makeTestDistributor } from "./_distributor.ts";

eventDistributorContract(makeTestDistributor("off-all"));
