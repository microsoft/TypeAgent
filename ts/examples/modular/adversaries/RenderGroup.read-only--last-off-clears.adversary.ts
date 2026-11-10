// Adversary: When the last listener is removed, the group frees its source's shapes.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("last-off-clears"));
