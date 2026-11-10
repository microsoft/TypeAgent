// Adversary: An item's ID is its position in z-order, so IDs shift and come back.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("ids-by-position"));
