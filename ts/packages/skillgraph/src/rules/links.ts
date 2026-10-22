// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import {
    rel,
    type BuildContext,
    type BuildResult,
    type Skill,
} from "../context.js";
import { parseMarkdown, type ParsedMarkdown } from "../markdown.js";
import type { Loc } from "../types.js";

// Markdown links: file exists, #anchor matches a heading.

const SCRIPT_EXT = /\.(py|js|mjs|cjs|ts|mts|sh|bash|zsh|rb|pl|ps1)$/;

export function linkEdges(
    ctx: BuildContext,
    skill: Skill,
    file: string,
    docId: string,
    md: ParsedMarkdown,
    res: BuildResult,
    referenced: Set<string>,
) {
    for (const l of md.links) {
        // External URLs and site-root links ("/docs/en/x" in mirrored docs).
        if (/^[a-z][a-z0-9+.-]*:/i.test(l.url) || l.url.startsWith("/"))
            continue;
        if (/[<>{}$*]/.test(l.url)) continue; // templates and globs
        const at: Loc = {
            file,
            line: l.line,
            col: l.col,
            endCol: l.endCol,
        };
        const [rawPath, anchor] = splitAnchor(l.url);
        const target = rawPath
            ? path.resolve(path.dirname(file), decodeURIComponent(rawPath))
            : file;
        // Links that climb out of the skill into a missing directory
        // ("../../security/advisories/new") are site routes, not files.
        if (
            path.relative(skill.dir, target).startsWith("..") &&
            !fs.existsSync(path.dirname(target))
        )
            continue;
        if (!fs.existsSync(target) && !ctx.hasOverlay(target)) {
            res.edges.push({
                from: docId,
                to: `file:${target}`,
                kind: "links",
                at,
                resolved: false,
            });
            res.diagnostics.push({
                rule: "link-broken",
                severity: "error",
                at,
                message: `${rawPath} does not exist`,
            });
            continue;
        }
        referenced.add(target);
        const inSkill =
            target.startsWith(skill.dir + path.sep) || target === skill.dir;
        const targetId =
            target === skill.entry
                ? `skill:${skill.id}`
                : inSkill
                  ? `${target.endsWith(".md") ? "doc" : SCRIPT_EXT.test(target) ? "script" : "asset"}:${rel(skill, target)}`
                  : `file:${target}`;
        if (anchor && target.endsWith(".md")) {
            const text = ctx.read(target) ?? "";
            const headings = (target === file ? md : parseMarkdown(text))
                .headings;
            const ok = headings.some((h) => h.slug === anchor.toLowerCase());
            res.edges.push({
                from: docId,
                to: `heading:${inSkill ? rel(skill, target) : target}#${anchor}`,
                kind: "links",
                at,
                resolved: ok,
            });
            if (!ok) {
                const have = headings
                    .slice(0, 6)
                    .map((h) => `#${h.slug}`)
                    .join(", ");
                res.diagnostics.push({
                    rule: "anchor-missing",
                    severity: "error",
                    at,
                    message: `#${anchor} not found in ${rawPath || path.basename(file)}${have ? ` (have: ${have})` : ""}`,
                });
            }
        } else {
            res.edges.push({
                from: docId,
                to: targetId,
                kind: "links",
                at,
                resolved: true,
            });
        }
    }
}

function splitAnchor(url: string): [string, string | undefined] {
    const i = url.indexOf("#");
    return i < 0 ? [url, undefined] : [url.slice(0, i), url.slice(i + 1)];
}
