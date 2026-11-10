// Adversary: An emit calls the most recent registration first.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("emit-newest-first"));
