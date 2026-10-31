// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseMarkdown, type MdHeading } from "../markdown.js";
import type { Skill } from "../context.js";
import { defineRule, type RuleContext } from "./sdk.js";

// "§N" cross-references resolve to a numbered heading.
//
//   "see §0h"                    → "## 0h. WRITING PYTHON" in this doc
//   "`Skill: guidelines` §6"     → "## 6. TOOL CONSTRAINTS" in guidelines/SKILL.md
//   "TTPs (§3) … (§7)" beyond the doc's numbering → another document's sections; skipped

/** "§6", "§ 0f.1", "§2a". */
const SECTION_REF = /§\s?(\d+[a-z]?(?:\.\d+)*)/g;
/** "## 6. TOOL", "### 0f.1 CONFIRMING", "## §3 Scope" → "6", "0f.1", "3". */
const NUMBERED = /^(?:§\s*)?(\d+[a-z]?(?:\.\d+)*)[.):]?(?:\s|$)/;
/** A backticked skill name just before the §, e.g. "`Skill: guidelines` §6". */
const NAMED_SKILL = /`(?:Skill:\s*)?([a-z][a-z0-9-]*)`[^`§]{0,20}$/;

function sectionIds(headings: MdHeading[]): Set<string> {
    const ids = new Set<string>();
    for (const h of headings) {
        const m = NUMBERED.exec(h.text.trim());
        if (m) ids.add(m[1]);
    }
    return ids;
}

/** Leading integer of a section id: "0f.1" → 0. */
const major = (id: string) => parseInt(id, 10);

function resolves(id: string, ids: Set<string>): boolean {
    // "§6.2" also matches when only "6" is a heading (numbered sub-lists).
    return ids.has(id) || ids.has(id.split(".")[0]);
}

function findSkill(ctx: RuleContext, name: string): Skill | undefined {
    const key = `${ctx.skill.root}\0${name}`;
    return ctx.byName.get(key) ?? ctx.aliases.get(key);
}

export const sectionsRule = defineRule({
    meta: {
        name: "sections",
        description: "§N references point to a numbered heading.",
        diagnostics: { "section-ref-unknown": "error" },
    },
    create: (ctx) => {
        const memo = new Map<string, Set<string>>();
        const skillSections = (s: Skill) => {
            let ids = memo.get(s.entry);
            if (!ids) {
                const text = ctx.read(s.entry);
                ids = text
                    ? sectionIds(parseMarkdown(text).headings)
                    : new Set();
                memo.set(s.entry, ids);
            }
            return ids;
        };
        return {
            doc: ({ file, md }) => {
                const local = sectionIds(md.headings);
                const localMax = Math.max(-1, ...[...local].map(major));
                const lines = md.text.split("\n");
                lines.forEach((text, i) => {
                    if (text.trimStart().startsWith("#")) return;
                    for (const m of text.matchAll(SECTION_REF)) {
                        const id = m[1];
                        const named = NAMED_SKILL.exec(text.slice(0, m.index));
                        const target = named && findSkill(ctx, named[1]);
                        let ids: Set<string>;
                        let where: string;
                        if (target) {
                            ids = skillSections(target);
                            where = `skill ${target.name}`;
                        } else {
                            // Only claim local refs inside this doc's numbering.
                            if (!local.size || major(id) > localMax) continue;
                            ids = local;
                            where = "this document";
                        }
                        if (resolves(id, ids)) continue;
                        const col = m.index + 1;
                        ctx.report({
                            rule: "section-ref-unknown",
                            at: {
                                file,
                                line: i + 1,
                                col,
                                endCol: col + m[0].length,
                            },
                            message: `§${id} has no numbered heading in ${where}`,
                        });
                    }
                });
            },
        };
    },
});
