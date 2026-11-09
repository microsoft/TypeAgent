// Adversary: the first root has side 2 however far from the origin the first shape is, so far out
// the root's edges round to the same values as it doubles. Found by the round-2 phase-2 agent.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("unit-root"));
