// Adversary: inRect removes empty shapes from the group, since no query finds them.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("query-drops-empty"));
