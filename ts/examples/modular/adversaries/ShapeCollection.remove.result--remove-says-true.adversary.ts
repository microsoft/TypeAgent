// Adversary: remove returns true even when the ID wasn't there.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("remove-says-true"));
