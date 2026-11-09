// Adversary: get still finds a removed item, from a cache of every item added.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("get-remembers-removed"));
