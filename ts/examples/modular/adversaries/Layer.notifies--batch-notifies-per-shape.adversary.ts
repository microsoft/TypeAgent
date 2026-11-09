// Adversary: removeMultiple emits change after each shape it removes.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("batch-notifies-per-shape"));
