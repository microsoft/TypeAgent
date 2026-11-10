// Adversary: atPoint reports each item twice.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("atPoint-twice"));
