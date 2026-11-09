// Adversary: atPoint returns out.length.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("atPoint-returns-length"));
