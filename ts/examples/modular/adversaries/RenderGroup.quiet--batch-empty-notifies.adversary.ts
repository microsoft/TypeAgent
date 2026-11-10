// Adversary: removeMultiple emits change even when it removed nothing.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("batch-empty-notifies"));
