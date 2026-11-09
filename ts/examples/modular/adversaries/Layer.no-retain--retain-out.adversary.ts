// Adversary: inRect keeps the last out array and appends later results to it too.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("retain-out"));
