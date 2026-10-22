// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import { rel, type BuildResult, type Skill } from "../context.js";

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
    for (const f of files) {
        if (referenced.has(f) || !usedDirs.has(path.dirname(f))) continue;
        const base = path.basename(f);
        if (base.startsWith(".")) continue;
        if (mentionText.some((t, i) => files[i] !== f && t.includes(base)))
            continue;
        res.diagnostics.push({
            rule: "orphan",
            severity: "info",
            at: { file: f, line: 1, col: 1, endCol: 1 },
            message: `${rel(skill, f)} is not referenced by any doc or script`,
        });
    }
}
