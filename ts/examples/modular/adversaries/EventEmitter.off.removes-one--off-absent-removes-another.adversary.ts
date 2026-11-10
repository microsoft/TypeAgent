// Adversary: off for a listener with no registration removes the most recent registration of any listener.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("off-absent-removes-another"));
