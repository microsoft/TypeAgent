// Adversary: Only the first registration is called.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("first-listener-only"));
