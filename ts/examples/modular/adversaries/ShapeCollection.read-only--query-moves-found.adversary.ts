// Adversary: atPoint, one of ShapeCollection's members, moves the shapes it finds to the top, as a most-recently-used cache would.
import { shapeCollectionWriterContract } from "../shapeModel.contract.ts";
import { TestShapeWriter } from "./_shapeModel.ts";

shapeCollectionWriterContract(() => new TestShapeWriter("query-moves-found"));
