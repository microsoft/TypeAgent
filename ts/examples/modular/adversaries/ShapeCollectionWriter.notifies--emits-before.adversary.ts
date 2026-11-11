// Adversary: Add emits change before inserting.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { TestShapeWriter } from "./_shapeModel.ts";

shapeCollectionWriterContract(() => new TestShapeWriter("emits-before"));
