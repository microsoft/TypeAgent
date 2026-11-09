// Adversary: off does nothing.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("off-ignored"));
