// Adversary: removeMultiple ignores the last listed ID.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("batch-skips-last"));
