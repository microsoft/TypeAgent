// Rule checking for circles: the rule checker (tool/cli/ruleCheck.ts, which
// says how it works) bound to the rules compiled from the circles interface
// files (rules.gen.ts).

import { compiledRules, interfaceShapes } from "./rules.gen.ts";
import { ruleChecker } from "./tool/cli/ruleCheck.ts";

export type { ObserveOptions, Violation } from "./tool/cli/ruleCheck.ts";

export const { rulesFor, checkInvariants, observe } = ruleChecker({ compiledRules, interfaceShapes });
