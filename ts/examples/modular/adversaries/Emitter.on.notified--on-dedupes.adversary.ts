// Adversary: A listener registered twice is called once.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("on-dedupes"));
