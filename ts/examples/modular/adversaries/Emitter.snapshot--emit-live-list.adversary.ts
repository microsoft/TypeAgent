// Adversary: An emit walks the live list, so listeners added during it are called and removed ones aren't.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("emit-live-list"));
