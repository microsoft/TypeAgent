// Adversary: off removes every registration of the listener.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("off-removes-all"));
