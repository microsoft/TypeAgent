// Adversary: A region contains the points on its right and bottom edges.
import { eventDistributorContract } from "../eventDistributor.contract.ts";
import { makeTestDistributor } from "./_distributor.ts";

eventDistributorContract(makeTestDistributor("closed-edges"));
