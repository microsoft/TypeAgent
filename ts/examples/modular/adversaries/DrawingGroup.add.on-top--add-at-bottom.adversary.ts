// Adversary: add puts the shape at the bottom.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("add-at-bottom"));
