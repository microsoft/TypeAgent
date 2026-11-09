// Adversary: atPoint checks the root's own shapes before the descent loop and again inside it.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("atPoint-root-twice"));
