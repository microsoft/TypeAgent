// Adversary: atPoint empties out before appending.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("atPoint-clears-out"));
