// Adversary: when the root grows left, the old root goes in the wrong child slot, so atPoint's index-based descent misses it.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("grow-wrong-quadrant"));
