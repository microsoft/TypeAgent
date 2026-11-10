// Adversary: removeMultiple emits change after each shape it removes.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("batch-notifies-per-shape"));
