// Adversary: removeMultiple([]) removes every shape.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("empty-batch-means-all"));
