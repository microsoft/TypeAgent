// Adversary: When the last listener is removed, the layer frees its source's shapes.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("last-off-clears"));
