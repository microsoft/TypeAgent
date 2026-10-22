// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BuildContext, BuildResult, Skill } from "../context.js";
import type { ParsedMarkdown } from "../markdown.js";
import type { Loc } from "../types.js";

// skill://name references resolve within configured roots.

export function skillEdges(
    ctx: BuildContext,
    skill: Skill,
    file: string,
    docId: string,
    md: ParsedMarkdown,
    res: BuildResult,
) {
    for (const r of md.skillRefs) {
        const at: Loc = {
            file,
            line: r.line,
            col: r.col,
            endCol: r.endCol,
        };
        const localKey = `${skill.root}\0${r.name}`;
        const matches = [
            ...ctx.byName.values(),
            ...ctx.aliases.values(),
        ].filter(
            (s) =>
                s.name === r.name ||
                ctx.aliases.get(`${s.root}\0${r.name}`) === s,
        );
        const unique = [...new Set(matches)];
        const target =
            ctx.byName.get(localKey) ??
            ctx.aliases.get(localKey) ??
            (unique.length === 1 ? unique[0] : undefined);
        const ok = target !== undefined;
        res.edges.push({
            from: docId,
            to: `skill:${target?.id ?? r.name}`,
            kind: "uses",
            at,
            resolved: ok,
        });
        if (!ok) {
            res.diagnostics.push({
                rule: "skill-unknown",
                severity: "error",
                at,
                message: `skill://${r.name} not found in configured roots`,
            });
        }
    }
}
