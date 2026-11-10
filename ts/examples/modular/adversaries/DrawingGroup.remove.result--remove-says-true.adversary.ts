// Adversary: remove returns true for an ID that wasn't there.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("remove-says-true"));
