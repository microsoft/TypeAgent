// Adversary: copies a straddling shape into every overlapping child and doesn't deduplicate.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("store-in-all-overlapping"));
