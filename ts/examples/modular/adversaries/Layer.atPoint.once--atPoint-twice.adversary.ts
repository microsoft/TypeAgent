// Adversary: atPoint reports each item twice.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("atPoint-twice"));
