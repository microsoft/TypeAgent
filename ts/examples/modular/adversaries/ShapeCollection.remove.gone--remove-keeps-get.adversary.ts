// Adversary: remove takes the shape out of z-order, but get still finds it.
import { shapeCollectionContract } from "../shapeCollection.contract.ts";
import { TestCollection } from "./_layer.ts";

shapeCollectionContract(() => new TestCollection("remove-keeps-get"));
