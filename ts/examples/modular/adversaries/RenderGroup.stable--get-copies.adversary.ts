// Adversary: get converts the shape into a new copy each time.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("get-copies"));
