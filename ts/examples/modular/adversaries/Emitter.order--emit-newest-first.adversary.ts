// Adversary: An emit calls the most recent registration first.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("emit-newest-first"));
