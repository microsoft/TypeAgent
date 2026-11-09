// Adversary: computes the count from out's length captured on the first query only.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("shared-out-length"));
