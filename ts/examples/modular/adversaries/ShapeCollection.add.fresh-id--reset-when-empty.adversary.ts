// Adversary: when a removal empties the collection, IDs start again from 1.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("reset-when-empty"));
