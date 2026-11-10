// Adversary: the collection it presents starts IDs again from 1 when it empties.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("ids-reset-when-empty"));
