// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Skill } from "../context.js";
import type { ParsedMarkdown } from "../markdown.js";
import type { BuildResult } from "../context.js";
import type { Diagnostic, Loc } from "../types.js";

// SKILL.md frontmatter: present, valid YAML, name matches dir, description bounded.

const DESCRIPTION_MAX = 1024;

export function checkFrontmatter(
    skill: Skill,
    md: ParsedMarkdown,
    res: BuildResult,
) {
    const at = (line = 1): Loc => ({
        file: skill.entry,
        line,
        col: 1,
        endCol: 4,
    });
    const push = (
        rule: string,
        severity: Diagnostic["severity"],
        message: string,
        line = 1,
    ) => res.diagnostics.push({ rule, severity, at: at(line), message });
    if (md.frontmatterError)
        return push("frontmatter-invalid", "error", md.frontmatterError);
    const fm = md.frontmatter;
    if (!fm)
        return push(
            "frontmatter-missing",
            "error",
            "SKILL.md has no YAML frontmatter",
        );
    const lineOf = (key: string) => {
        const i = md.text.split("\n").findIndex((l) => l.startsWith(`${key}:`));
        return i >= 0 ? i + 1 : 1;
    };
    if (typeof fm.name !== "string")
        push("name-missing", "error", "frontmatter has no `name`");
    else if (fm.name !== skill.name) {
        push(
            "name-mismatch",
            "warn",
            `name "${fm.name}" does not match directory "${skill.name}"`,
            lineOf("name"),
        );
    }
    if (typeof fm.description !== "string" || !fm.description.trim()) {
        push(
            "description-missing",
            "error",
            "frontmatter has no `description`",
        );
    } else if (fm.description.length > DESCRIPTION_MAX) {
        push(
            "description-too-long",
            "warn",
            `${fm.description.length} > ${DESCRIPTION_MAX} chars`,
            lineOf("description"),
        );
    }
}
