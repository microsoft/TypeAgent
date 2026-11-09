// Adversary: removeMultiple's merge pass counts only a node's direct children and collapses them, dropping grandchildren. Escapes: the suite never builds a tree two levels deep under a merge.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("merge-drops-grandchildren"));
