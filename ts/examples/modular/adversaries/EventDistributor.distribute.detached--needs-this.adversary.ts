// Adversary: Distribute is a method that fails when called detached.
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { makeTestDistributor } from "./_distributor.ts";

eventDistributorContract(makeTestDistributor("needs-this"));
