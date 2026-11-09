// Adversary: the next ID is size + 1, so a removed shape's ID comes back.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("reuse-ids"));
