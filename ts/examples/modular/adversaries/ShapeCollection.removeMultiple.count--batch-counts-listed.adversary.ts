// Adversary: removeMultiple returns how many IDs were listed.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("batch-counts-listed"));
