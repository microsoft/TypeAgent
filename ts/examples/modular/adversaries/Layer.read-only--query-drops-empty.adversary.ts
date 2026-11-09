// Adversary: inRect removes empty shapes from the layer, since no query finds them.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("query-drops-empty"));
