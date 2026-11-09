// Adversary: recomputes midlines and grown roots from x + size instead of storing them, so after
// rounding a grown root's quadrants disagree with the old root they hold. Found by the round-2
// phase-2 agent; the grid-exact sequences couldn't reach it.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("recomputed-bounds"));
