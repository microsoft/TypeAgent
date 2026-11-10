// Adversary: An emit walks the live list, so listeners added during it are called and removed ones aren't.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("emit-live-list"));
