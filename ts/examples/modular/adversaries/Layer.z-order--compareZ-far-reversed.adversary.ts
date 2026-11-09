// Adversary: compareZ flips the sign for items 2 or more apart, so only neighbors compare correctly.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("compareZ-far-reversed"));
