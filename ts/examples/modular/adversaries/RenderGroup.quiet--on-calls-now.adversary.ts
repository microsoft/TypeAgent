// Adversary: on calls the new listener at once, as some observable stores do.
import { renderGroupContract } from "../renderGroup.contract.ts";
import { TestGroup } from "./_group.ts";

renderGroupContract(() => new TestGroup("on-calls-now"));
