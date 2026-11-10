// Adversary: inRect keeps the last out array and appends later results to it too.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("retain-out"));
