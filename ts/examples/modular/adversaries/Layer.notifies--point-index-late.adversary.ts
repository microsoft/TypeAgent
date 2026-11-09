// Adversary: atPoint uses a second index that is updated after change is emitted, so a listener's atPoint is stale.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("point-index-late"));
