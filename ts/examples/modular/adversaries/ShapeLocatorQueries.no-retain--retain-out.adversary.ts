// Adversary: keeps the last out array and appends later results to it too: query into out1, query into out2, and out1 has grown.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("retain-out"));
