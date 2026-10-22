// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import type { Root, Nodes } from "mdast";
import { parse as parseYaml } from "yaml";

// Extracts the explicit references from one Markdown file. Only syntax
// counts: links, headings, code fences, inline code, and `skill://` text.

export interface MdLink {
    url: string;
    line: number;
    col: number;
    endCol: number;
}

export interface MdHeading {
    text: string;
    slug: string;
    line: number;
}

export interface MdCode {
    /** Fence language, or "inline" for inline code spans. */
    lang: string;
    value: string;
    /** 1-based line of the first content line. */
    line: number;
    col: number;
}

export interface MdSkillRef {
    name: string;
    line: number;
    col: number;
    endCol: number;
}

export interface ParsedMarkdown {
    frontmatter?: Record<string, unknown>;
    frontmatterError?: string;
    /** Number of lines the frontmatter block occupies. */
    frontmatterLines: number;
    links: MdLink[];
    headings: MdHeading[];
    code: MdCode[];
    skillRefs: MdSkillRef[];
    text: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SKILL_REF = /skill:\/\/([a-z0-9][a-z0-9_-]*)/g;

/** GitHub's slugger: lowercase, drop punctuation, spaces → "-", dedupe "-1". */
export function slugger() {
    const seen = new Map<string, number>();
    return (text: string): string => {
        const base = text
            .toLowerCase()
            .trim()
            .replace(/[^\p{L}\p{N}\p{M}\p{Pc} -]/gu, "")
            .replace(/ /g, "-");
        const n = seen.get(base);
        seen.set(base, (n ?? -1) + 1);
        return n === undefined ? base : `${base}-${n + 1}`;
    };
}

export function parseMarkdown(text: string): ParsedMarkdown {
    // Frontmatter is replaced by blank lines so mdast positions stay true.
    const fm = FRONTMATTER.exec(text);
    let frontmatter: Record<string, unknown> | undefined;
    let frontmatterError: string | undefined;
    let frontmatterLines = 0;
    let body = text;
    if (fm) {
        frontmatterLines = fm[0].split("\n").length - 1;
        try {
            const value = parseYaml(fm[1]);
            frontmatter =
                value && typeof value === "object"
                    ? (value as Record<string, unknown>)
                    : {};
        } catch (e) {
            frontmatterError = (e as Error).message.split("\n")[0];
        }
        body = "\n".repeat(frontmatterLines) + text.slice(fm[0].length);
    }

    // Table cells isolate code spans; plain CommonMark can pair backticks across rows.
    const tree: Root = fromMarkdown(body, {
        extensions: [gfmTable()],
        mdastExtensions: [gfmTableFromMarkdown()],
    });
    const out: ParsedMarkdown = {
        frontmatterLines,
        links: [],
        headings: [],
        code: [],
        skillRefs: [],
        text,
    };
    if (frontmatter) out.frontmatter = frontmatter;
    if (frontmatterError) out.frontmatterError = frontmatterError;

    const slug = slugger();
    // A template may declare data roots for angle-delimited JSON selectors.
    const templateRoots =
        /Document roots available to the parser:\s*([\s\S]*?)(?:\n\s*\n)/
            .exec(body)?.[1]
            .split(/[\s,]+/)
            .filter(Boolean) ?? [];
    const visit = (node: Nodes) => {
        const pos = node.position?.start;
        switch (node.type) {
            case "link":
            case "definition":
                if (pos) {
                    // Point at the URL, e.g. "[x](refs/a.md)" → column of "refs".
                    const lineText = body.split("\n")[pos.line - 1] ?? "";
                    const idx = lineText.indexOf(node.url, pos.column - 1);
                    const col = idx >= 0 ? idx + 1 : pos.column;
                    const selector =
                        /^([a-z_][\w]*)(?:\.[a-z_][\w]*|\[where [a-z_][\w]* == [a-z_][\w]*(?:\.[a-z_][\w]*)*\])+$/.exec(
                            node.url,
                        );
                    if (
                        selector &&
                        templateRoots.includes(selector[1]) &&
                        lineText.slice(idx - 1, idx + node.url.length + 1) ===
                            `<${node.url}>`
                    )
                        break;
                    out.links.push({
                        url: node.url,
                        line: pos.line,
                        col,
                        endCol: col + node.url.length,
                    });
                }
                break;
            case "heading": {
                let text = toText(node);
                const line = pos?.line ?? 1;
                // Explicit id: "## Setup {#install}" or "## Setup [#install]" (Fumadocs).
                const explicit = /\s*[{[]#([\w-]+)[}\]]\s*$/.exec(text);
                if (explicit) {
                    text = text.slice(0, explicit.index);
                    out.headings.push({ text, slug: explicit[1], line });
                }
                out.headings.push({ text, slug: slug(text), line });
                // Docs sites (Mintlify, Docusaurus) slug "CLAUDE.md" as "claude-md".
                const alt = altSlug(text);
                if (alt !== out.headings[out.headings.length - 1].slug) {
                    out.headings.push({ text, slug: alt, line });
                }
                break;
            }
            case "html": {
                // <a id="x"></a>, <a name="x">, <h3 id="x"> anchors.
                for (const m of node.value.matchAll(
                    /<[a-z][\w-]*\s[^>]*?\b(?:id|name)=["']([^"']+)["']/g,
                )) {
                    out.headings.push({
                        text: m[1],
                        slug: m[1].toLowerCase(),
                        line: pos?.line ?? 1,
                    });
                }
                break;
            }
            case "code":
                if (pos) {
                    out.code.push({
                        lang: (node.lang ?? "").toLowerCase(),
                        value: node.value,
                        line: pos.line + 1,
                        col: pos.column,
                    });
                }
                return;
            case "inlineCode":
                if (pos) {
                    out.code.push({
                        lang: "inline",
                        value: node.value,
                        line: pos.line,
                        col: pos.column + 1,
                    });
                }
                break;
        }
        if ("children" in node) {
            for (const child of node.children) visit(child as Nodes);
        }
    };
    visit(tree);

    // skill:// can appear in prose, code, or link text, so scan raw lines.
    // Fenced code is included: a fence that names skill://x still references x.
    body.split("\n").forEach((lineText, i) => {
        for (const m of lineText.matchAll(SKILL_REF)) {
            const col = (m.index ?? 0) + 1;
            out.skillRefs.push({
                name: m[1],
                line: i + 1,
                col,
                endCol: col + m[0].length,
            });
        }
    });
    return out;
}

function altSlug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

function toText(node: Nodes): string {
    if ("value" in node && typeof node.value === "string") return node.value;
    if ("children" in node) {
        return (node.children as Nodes[]).map(toText).join("");
    }
    return "";
}
