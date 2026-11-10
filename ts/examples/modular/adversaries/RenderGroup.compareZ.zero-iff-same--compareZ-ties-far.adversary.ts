// Adversary: compareZ returns 0 for items 2 or more apart.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("compareZ-ties-far"));
