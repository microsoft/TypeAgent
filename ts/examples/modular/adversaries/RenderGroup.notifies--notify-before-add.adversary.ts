// Adversary: Emits change before the shape is in the collection.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("notify-before-add"));
