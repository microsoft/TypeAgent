// Adversary: atPoint uses a second index that is updated after change is emitted, so a listener's atPoint is stale.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("point-index-late"));
