// Adversary: inRect empties out before appending.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("inRect-clears-out"));
