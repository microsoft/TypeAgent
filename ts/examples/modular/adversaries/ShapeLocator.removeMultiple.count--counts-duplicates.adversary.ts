// Adversary: counts every listed ID that was present at the start, so duplicates count twice.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("batch-counts-duplicates"));
