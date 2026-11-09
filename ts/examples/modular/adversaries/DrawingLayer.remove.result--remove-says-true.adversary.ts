// Adversary: remove returns true for an ID that wasn't there.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("remove-says-true"));
