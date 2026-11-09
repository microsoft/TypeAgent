// Adversary: compareZ returns 0 for items 2 or more apart.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("compareZ-ties-far"));
