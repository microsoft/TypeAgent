import { describe } from "node:test";
import { renderGroupContract } from "./renderGroup.contract.ts";
import { ListLocator } from "./listLocator.ts";
import { MapShapeCollection } from "./mapShapeCollection.ts";
import { QuadTreeLocator } from "./quadTreeLocator.ts";
import { ShapeGroup } from "./shapeGroup.ts";

// One group implementation over the real collection and two interchangeable
// locators. Part of no generation task: it runs once all of them exist.
describe("over ListLocator", () => renderGroupContract(() => new ShapeGroup(new MapShapeCollection(), new ListLocator())));
describe("over QuadTreeLocator", () => renderGroupContract(() => new ShapeGroup(new MapShapeCollection(), new QuadTreeLocator())));
