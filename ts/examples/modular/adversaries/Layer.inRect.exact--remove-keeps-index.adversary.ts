// Adversary: remove leaves the shape in the index.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("remove-keeps-index"));
