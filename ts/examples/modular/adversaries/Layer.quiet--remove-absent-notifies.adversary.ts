// Adversary: remove emits change even when the ID wasn't there.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("remove-absent-notifies"));
