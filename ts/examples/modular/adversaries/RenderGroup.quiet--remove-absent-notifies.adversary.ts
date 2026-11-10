// Adversary: remove emits change even when the ID wasn't there.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("remove-absent-notifies"));
