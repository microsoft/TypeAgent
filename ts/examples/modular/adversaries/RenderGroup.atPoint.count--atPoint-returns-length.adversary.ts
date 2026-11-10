// Adversary: atPoint returns out.length.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("atPoint-returns-length"));
