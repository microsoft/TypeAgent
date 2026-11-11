// Adversary: CompareZ compares the positions of the shape objects, so two adds of one shape compare equal.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { TestShapeWriter } from "./_shapeModel.ts";

shapeCollectionWriterContract(() => new TestShapeWriter("compares-shapes"));
