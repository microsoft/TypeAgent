// Adversary: add returns the ID after the one it stored the shape under.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("add-returns-next"));
