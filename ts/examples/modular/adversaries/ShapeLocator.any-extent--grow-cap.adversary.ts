// Adversary: gives up (throws) after 64 doublings of the root. Escapes: any-extent only reaches 1e15, about 51 doublings.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("grow-cap"));
