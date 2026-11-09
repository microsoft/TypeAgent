// Adversary: a quadtree whose atPoint descends into the low child when p lies exactly on a cell's midline (p.x > mid instead of p.x >= mid). Caught only ~30% of runs: the suite rarely builds a split cell with a shape starting on the midline.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("point-on-mid-goes-low"));
