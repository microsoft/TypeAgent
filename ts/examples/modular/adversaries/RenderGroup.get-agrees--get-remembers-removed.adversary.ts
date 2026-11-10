// Adversary: get still finds a removed item, from a cache of every item added.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("get-remembers-removed"));
