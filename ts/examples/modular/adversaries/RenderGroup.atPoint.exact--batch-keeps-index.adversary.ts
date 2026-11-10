// Adversary: removeMultiple leaves the shapes in the index.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("batch-keeps-index"));
