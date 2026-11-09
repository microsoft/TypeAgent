// Adversary: After its last listener is removed, the layer stops emitting for good.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("detach-when-no-listeners"));
