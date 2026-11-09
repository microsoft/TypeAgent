// Adversary: size forgets the shapes removeMultiple removed.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("size-counts-adds"));
