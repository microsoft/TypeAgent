// Adversary: enforces 'once' with out.includes(id) over all of out, so an ID the caller already had in out is not reported. Escapes: prefilled out arrays only ever hold the sentinel -1.
import { shapeLocatorContract } from "../shapeLocator.contract.ts";
import { QuadTree } from "./_quadtree.ts";

shapeLocatorContract(() => new QuadTree("dedupe-includes"));
