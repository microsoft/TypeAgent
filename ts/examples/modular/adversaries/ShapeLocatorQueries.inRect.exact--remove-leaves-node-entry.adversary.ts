// Adversary: remove() forgets the ID but leaves the shape in its node.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("remove-leaves-node-entry"));
