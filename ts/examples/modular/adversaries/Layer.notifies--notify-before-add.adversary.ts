// Adversary: Emits change before the shape is in the collection.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("notify-before-add"));
