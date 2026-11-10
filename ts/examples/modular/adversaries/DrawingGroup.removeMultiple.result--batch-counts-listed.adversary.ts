// Adversary: removeMultiple returns how many IDs were listed.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("batch-counts-listed"));
