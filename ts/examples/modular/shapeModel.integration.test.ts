import { describe } from "node:test";
import { shapeCollectionWriterContract, shapeMessageProcessorContract } from "./shapeModel.contract.ts";
import { ListLocator } from "./listLocator.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { MapShapeCollection } from "./mapShapeCollection.ts";
import { ShapeProcessor } from "./shapeProcessor.ts";

// The real writer over two interchangeable locators, and the real processor
// over each. Part of no generation task: it runs once all of them exist.
describe("over ListLocator", () => {
  shapeCollectionWriterContract(() => new MapShapeCollection(new ListLocator()));
  shapeMessageProcessorContract((clientId) => new ShapeProcessor(clientId, new MapShapeCollection(new ListLocator())));
});
describe("over QuadTreeLocator", () => {
  shapeCollectionWriterContract(() => new MapShapeCollection(new QuadTreeLocator()));
  shapeMessageProcessorContract((clientId) => new ShapeProcessor(clientId, new MapShapeCollection(new QuadTreeLocator())));
});
