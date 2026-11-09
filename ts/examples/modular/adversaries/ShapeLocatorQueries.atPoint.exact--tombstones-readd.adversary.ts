// Adversary: lazy deletion: remove() adds the ID to a dead set that add() never clears, so a re-added ID stays invisible. The interface says to change geometry by removing and adding again, but the suite never re-adds an ID.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("tombstones"));
