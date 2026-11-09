// Adversary: off for a listener with no registration removes the most recent registration of any listener.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("off-absent-removes-another"));
