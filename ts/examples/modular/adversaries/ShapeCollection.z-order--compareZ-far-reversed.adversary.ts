// Adversary: compareZ flips the sign for shapes 2 or more apart unless one is the top shape, so only neighbors compare correctly.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("compareZ-far-reversed"));
