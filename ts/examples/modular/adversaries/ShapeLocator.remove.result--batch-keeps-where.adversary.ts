// Adversary: removeMultiple deletes shapes from their nodes but not from the ID map, so a later remove() of the same ID returns true.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("batch-keeps-where"));
