// Adversary: compareZ says "above" both ways for shapes 3 apart.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("compareZ-asymmetric"));
