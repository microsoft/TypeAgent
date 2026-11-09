// Adversary: sizes the root from the first shape's box; when that box is empty the root has size 0 and can never grow, so the next add throws. Escapes: the suite never adds an empty shape.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("zero-size-root"));
