// Adversary: inRect replaces each shape it finds with a box of its bounding box.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("query-boxes-found"));
