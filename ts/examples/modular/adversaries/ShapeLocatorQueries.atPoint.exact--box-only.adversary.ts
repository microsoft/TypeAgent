// Adversary: atPoint answers from bounding boxes.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { TestShapeWriter } from "./_shapeModel.ts";

shapeCollectionWriterContract(() => new TestShapeWriter("box-only"));
