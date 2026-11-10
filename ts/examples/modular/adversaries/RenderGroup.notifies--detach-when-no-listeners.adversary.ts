// Adversary: After its last listener is removed, the group stops emitting for good.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("detach-when-no-listeners"));
