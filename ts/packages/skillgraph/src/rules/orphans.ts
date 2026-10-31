// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import { type BuildResult, type Skill } from "../context.js";
import { defineRule } from "./sdk.js";

// Orphans: unreferenced files beside referenced ones (info only —
// scripts load assets through string literals we don't model).
// Only folders the docs already use count as skill content, e.g.
// scripts/old.py next to a linked scripts/fetch.py. Folders nothing
// references (crates/, tests/, the skill root itself) are other
// tooling's inputs, not skill content.
export function checkOrphans(
    skill: Skill,
    files: string[],
    mentionText: string[],
    referenced: Set<string>,
    res: BuildResult,
) {
    const usedDirs = new Set(
        [...referenced]
            .map((r) => path.dirname(r))
            .filter((d) => d !== skill.dir),
    );
    // A referenced folder covers every file under it, e.g. a link to
    // references/tables/ covers references/tables/x/y.md.
    const fileSet = new Set(files);
    const refDirs = [...referenced].filter((r) => !fileSet.has(r));
    for (const f of files) {
        if (referenced.has(f) || !usedDirs.has(path.dirname(f))) continue;
        if (refDirs.some((d) => f.startsWith(d + path.sep))) continue;
        const base = path.basename(f);
        if (base.startsWith(".")) continue;
        if (mentionText.some((t, i) => files[i] !== f && t.includes(base)))
            continue;
        res.diagnostics.push({
            rule: "orphan",
            severity: "info",
            at: { file: f, line: 1, col: 1, endCol: 1 },
            message: `${skill.name}/${path.relative(skill.dir, f).split(path.sep).join("/")} is not referenced by any doc or script`,
        });
    }
}

export const orphansRule = defineRule({
    meta: {
        name: "orphans",
        description: "Files beside referenced ones are referenced too.",
        diagnostics: { orphan: "info" },
    },
    // Runs after all docs so `referenced` is complete.
    create: (ctx) => ({
        skillEnd: () =>
            checkOrphans(
                ctx.skill,
                ctx.files,
                ctx.files.map((f) => ctx.read(f) ?? ""),
                ctx.referenced,
                ctx.result,
            ),
    }),
});
