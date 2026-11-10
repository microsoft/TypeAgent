// Adversary: On ignores a registration that exists already.
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { makeTestDistributor } from "./_distributor.ts";

eventDistributorContract(makeTestDistributor("dedupes"));
