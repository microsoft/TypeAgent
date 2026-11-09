// Adversary: size is the layer's own count, which removeMultiple forgets to update.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("size-own-count"));
