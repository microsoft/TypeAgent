// Adversary: places a shape in the child holding its top-left corner even when its box sticks out of that child.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("place-by-corner"));
