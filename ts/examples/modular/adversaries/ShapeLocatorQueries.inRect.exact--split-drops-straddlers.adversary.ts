// Adversary: on split, shapes that fit no child are lost.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("split-drops-straddlers"));
