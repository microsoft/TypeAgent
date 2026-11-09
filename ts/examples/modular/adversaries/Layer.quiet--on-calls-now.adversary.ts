// Adversary: on calls the new listener at once, as some observable stores do.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("on-calls-now"));
