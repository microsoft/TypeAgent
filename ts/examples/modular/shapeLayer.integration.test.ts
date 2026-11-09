import { describe } from "node:test";
import { layerContract } from "./layer.contract.ts";
import { ListLocator } from "./listLocator.ts";
import { MapShapeCollection } from "./mapShapeCollection.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { ShapeLayer } from "./shapeLayer.ts";

// One layer implementation over the real collection and two interchangeable
// locators. Part of no generation task: it runs once all of them exist.
describe("over ListLocator", () => layerContract(() => new ShapeLayer(new MapShapeCollection(), new ListLocator())));
describe("over QuadTreeLocator", () => layerContract(() => new ShapeLayer(new MapShapeCollection(), new QuadTreeLocator())));
