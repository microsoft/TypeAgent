// Adversary: remove() runs a top-down merge that drops grandchildren. Named for the closest rule; remove() has no rule beyond result, so the test that would catch it is the exact rule after deep trees, which the suite never builds.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("merge-on-remove-drops-grandchildren"));
