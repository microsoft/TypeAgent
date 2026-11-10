// Adversary: size is the group's own count, which removeMultiple forgets to update.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("size-own-count"));
