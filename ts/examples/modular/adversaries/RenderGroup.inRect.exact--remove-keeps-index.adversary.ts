// Adversary: remove leaves the shape in the index.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("remove-keeps-index"));
