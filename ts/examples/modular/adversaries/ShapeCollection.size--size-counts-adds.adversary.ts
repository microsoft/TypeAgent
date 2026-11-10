// Adversary: size forgets the shapes removeMultiple removed.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("size-counts-adds"));
