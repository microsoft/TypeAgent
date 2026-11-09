// Adversary: queries check only shapes stored in leaves, not those kept in internal nodes.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("skip-internal-items"));
