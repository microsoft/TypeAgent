// Adversary: off removes the earliest registration rather than the most recent.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("off-removes-first"));
