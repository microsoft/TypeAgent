// Adversary: removeMultiple returns how many IDs were listed.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("batch-counts-listed"));
