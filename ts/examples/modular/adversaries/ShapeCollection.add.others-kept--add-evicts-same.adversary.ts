// Adversary: add first removes an earlier add of the same shape object, as a set would.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("add-evicts-same"));
