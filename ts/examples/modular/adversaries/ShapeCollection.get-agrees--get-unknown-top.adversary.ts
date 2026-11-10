// Adversary: get returns the top shape for an ID it never returned.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("get-unknown-top"));
