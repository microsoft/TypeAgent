// Adversary: a removal that empties the layer calls no one.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("emptying-silent"));
