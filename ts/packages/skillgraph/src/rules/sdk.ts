// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BuildContext, BuildResult, Skill } from "../context.js";
import type { ParsedMarkdown } from "../markdown.js";
import type { Diagnostic, Severity } from "../types.js";

// Rule SDK. A rule declares the diagnostics it can emit and returns visitors.
//
//   defineRule({ meta, create(ctx) { return { doc(d) {…}, skillEnd() {…} } } })
//
//   build ─▶ for each skill: create(ctx) ─▶ doc() per *.md ─▶ skillEnd()
//
// Default severity comes from meta.diagnostics; .skillgraphrc.json "rules"
// can override it, e.g. { "orphan": "off", "tool-unknown": "warn" }.

/** One Markdown file of the skill, already parsed. */
export interface DocInput {
    file: string;
    /** Graph node id, e.g. "skill:review" or "doc:review/references/x.md". */
    id: string;
    md: ParsedMarkdown;
    isEntry: boolean;
}

export interface RuleContext extends BuildContext {
    skill: Skill;
    /** Every file in the skill directory (depth ≤ 4). */
    files: string[];
    /** Files reached by a link or command so far; read by orphan checks. */
    referenced: Set<string>;
    /** Shared output: rules add edges, specs, and probes here. */
    result: BuildResult;
    /** Severity is filled from meta.diagnostics[rule]. */
    report(d: Omit<Diagnostic, "severity">): void;
}

export interface RuleVisitor {
    doc?(d: DocInput): void;
    skillEnd?(): void;
}

export interface RuleMeta {
    name: string;
    description: string;
    /** Diagnostic ids this rule reports, with default severity. */
    diagnostics: Record<string, Severity>;
}

export interface Rule {
    meta: RuleMeta;
    create(ctx: RuleContext): RuleVisitor;
}

export function defineRule(rule: Rule): Rule {
    return rule;
}
