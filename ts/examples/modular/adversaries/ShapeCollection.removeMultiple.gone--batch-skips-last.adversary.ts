// Adversary: removeMultiple ignores the last listed ID.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("batch-skips-last"));
