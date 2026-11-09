// Adversary: inRect drops empty shapes it passes, since no query can ever find them.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("query-drops-empty"));
