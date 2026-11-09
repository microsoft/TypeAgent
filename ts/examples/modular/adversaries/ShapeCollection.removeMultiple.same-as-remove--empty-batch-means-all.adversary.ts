// Adversary: removeMultiple([]) removes every shape.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("empty-batch-means-all"));
