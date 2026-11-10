// Adversary: a removal that empties the group calls no one.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("emptying-silent"));
