// Adversary: off removes every registration of the listener.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("off-removes-all"));
