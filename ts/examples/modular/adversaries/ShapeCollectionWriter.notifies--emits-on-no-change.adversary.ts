// Adversary: Remove emits change even when it removed nothing.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { TestShapeWriter } from "./_shapeModel.ts";

shapeCollectionWriterContract(() => new TestShapeWriter("emits-on-no-change"));
