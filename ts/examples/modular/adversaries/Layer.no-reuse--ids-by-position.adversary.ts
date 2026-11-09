// Adversary: An item's ID is its position in z-order, so IDs shift and come back.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("ids-by-position"));
