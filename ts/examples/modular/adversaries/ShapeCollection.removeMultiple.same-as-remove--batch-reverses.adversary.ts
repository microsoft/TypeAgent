// Adversary: removeMultiple reverses the z-order of the shapes it keeps.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("batch-reverses"));
