// Adversary: remove also drops every shape above the removed one.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_group.ts";

shapeCollectionContract(() => new TestCollection("remove-drops-above"));
