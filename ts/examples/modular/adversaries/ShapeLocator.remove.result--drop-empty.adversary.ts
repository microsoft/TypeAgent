// Adversary: doesn't index shapes whose bounding box is empty (they can never match a query), so remove() of one returns false. Escapes: the suite only adds non-empty shapes.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("drop-empty"));
