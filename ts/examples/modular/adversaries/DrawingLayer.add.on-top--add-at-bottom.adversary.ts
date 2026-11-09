// Adversary: add puts the shape at the bottom.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("add-at-bottom"));
