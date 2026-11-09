// Adversary: removeMultiple emits change even when it removed nothing.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("batch-empty-notifies"));
