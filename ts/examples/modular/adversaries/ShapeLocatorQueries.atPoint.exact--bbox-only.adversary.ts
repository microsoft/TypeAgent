// Adversary: atPoint answers from bounding boxes instead of asking the shape.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("bbox-only-atPoint"));
