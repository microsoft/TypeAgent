// Adversary: removeMultiple rebuilds its storage, giving the shapes it keeps new IDs.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("batch-renumbers"));
