// Adversary: compareZ flips the sign for items 2 or more apart, so only neighbors compare correctly.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("compareZ-far-reversed"));
