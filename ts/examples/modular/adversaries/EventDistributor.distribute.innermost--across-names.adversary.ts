// Adversary: Picks the innermost target among all targets, whatever they're registered for.
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { makeTestDistributor } from "./_distributor.ts";

eventDistributorContract(makeTestDistributor("across-names"));
