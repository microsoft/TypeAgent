// Adversary: removeMultiple leaves the shapes in the index.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("batch-keeps-index"));
