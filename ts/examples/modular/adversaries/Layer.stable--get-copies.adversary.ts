// Adversary: get converts the shape into a new copy each time.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("get-copies"));
