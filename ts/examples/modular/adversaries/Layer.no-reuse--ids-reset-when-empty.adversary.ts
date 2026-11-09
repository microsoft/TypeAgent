// Adversary: the collection it presents starts IDs again from 1 when it empties.
import { layerContract } from "../layer.contract.ts";
import { TestLayer } from "./_layer.ts";

layerContract(() => new TestLayer("ids-reset-when-empty"));
