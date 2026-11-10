// Adversary: add puts the new shape at the bottom.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("add-at-bottom"));
