// Adversary: enforces 'once' by rewriting all of out through a Set, collapsing the caller's entries.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("dedupe-whole-out"));
