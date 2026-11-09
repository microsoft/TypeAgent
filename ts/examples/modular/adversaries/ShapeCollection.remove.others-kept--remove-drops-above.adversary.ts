// Adversary: remove also drops every shape above the removed one.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("remove-drops-above"));
