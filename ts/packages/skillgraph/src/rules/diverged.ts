// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import { listFiles } from "../discover.js";
import { defineRule } from "./sdk.js";

// Copies of one skill (same name, different roots) must stay identical, or
// agents silently run different instructions. Intended forks go in
// .skillgraphrc.json "allowDiverged".
//
//   agentA/skills/kb-report-format  ≠  agentB/skills/kb-report-format
//     → skill-diverged: SKILL.md, references/x.md differ from agentB copy

/** Files listed in the message before "and N more". */
const MAX_LISTED = 3;

export const divergedRule = defineRule({
    meta: {
        name: "diverged",
        description: "Copies of a skill in different roots are identical.",
        diagnostics: { "skill-diverged": "warn" },
    },
    create: (ctx) => ({
        skillEnd: () => {
            const { skill } = ctx;
            if (ctx.config.allowDiverged?.includes(skill.name)) return;
            const copies = [...ctx.byName.values()].filter(
                // Report each pair once, on the lexically first copy.
                (s) => s.name === skill.name && s.dir > skill.dir,
            );
            const mine = new Map(
                ctx.files.map((f) => [path.relative(skill.dir, f), f]),
            );
            for (const other of copies) {
                const theirs = new Map(
                    listFiles(other.dir).map((f) => [
                        path.relative(other.dir, f),
                        f,
                    ]),
                );
                const names = new Set([...mine.keys(), ...theirs.keys()]);
                const differ = [...names]
                    .filter((n) => {
                        const a = mine.get(n);
                        const b = theirs.get(n);
                        return !a || !b || ctx.read(a) !== ctx.read(b);
                    })
                    .sort();
                if (!differ.length) continue;
                const listed = differ.slice(0, MAX_LISTED).join(", ");
                const more =
                    differ.length > MAX_LISTED
                        ? ` and ${differ.length - MAX_LISTED} more`
                        : "";
                ctx.report({
                    rule: "skill-diverged",
                    at: { file: skill.entry, line: 1, col: 1, endCol: 4 },
                    message: `${listed}${more} differ from copy in ${path.relative(skill.dir, other.dir)}`,
                });
            }
        },
    }),
});
