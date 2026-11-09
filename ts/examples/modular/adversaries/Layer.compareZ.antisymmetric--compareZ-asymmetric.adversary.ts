// Adversary: compareZ says above both ways for items 2 apart.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("compareZ-asymmetric"));
