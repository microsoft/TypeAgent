// Adversary: compareZ says above both ways for items 2 apart.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("compareZ-asymmetric"));
