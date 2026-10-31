// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commandsRule } from "./commands.js";
import { frontmatterRule } from "./frontmatter.js";
import { linksRule } from "./links.js";
import { orphansRule } from "./orphans.js";
import type { Rule } from "./sdk.js";
import { skillsRule } from "./skills.js";

// Built-in rules, in run order. To add a rule: create rules/<name>.ts with
// defineRule(), then list it here. orphans must stay last (reads `referenced`).

export const RULES: Rule[] = [
    frontmatterRule,
    linksRule,
    skillsRule,
    commandsRule,
    orphansRule,
];

export { MAX_SUBCOMMAND_DEPTH } from "./commands.js";
export * from "./sdk.js";
