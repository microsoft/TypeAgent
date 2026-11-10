// Adversary: Get moves the shape it finds to the top, as a most-recently-used cache would.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("get-moves-to-top"));
