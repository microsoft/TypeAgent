// Adversary: compareZ compares positions / 2, so neighbors tie.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("compareZ-coarse"));
