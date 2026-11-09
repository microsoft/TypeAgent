// Adversary: lazy deletion whose tombstone add() never clears; a removed-then-re-added ID is never reported. Escapes: the suite never re-adds an ID.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("tombstones"));
