// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { walkLinesWithFences } from "./fenceWalker.js";
import { parseInlineLinks } from "./linkExtraction.js";

/**
 * Post-process LLM documentation output to mechanically fix the most
 * common, trivially-recoverable validation violations BEFORE running
 * the structural validator. This keeps the retry budget focused on
 * substantive issues (missing sections, marketing copy) rather than
 * mechanical slip-ups the model can't reliably avoid (bare code
 * fences, accidental clickable URLs).
 *
 * Repairs are intentionally narrow and reversible: they never
 * invent content, never change wording, and never delete information.
 * The repaired body is always semantically equivalent or strictly
 * less link-y than the input.
 */

/**
 * Apply every safe repair in sequence and return the final body.
 * Each step is idempotent so calling this twice yields the same result.
 */
export function repairOutput(body: string): string {
    let s = body;
    s = repairBareCodeFences(s);
    s = repairAbsoluteLinks(s);
    s = repairH1Headings(s);
    s = repairSelfReadmeLinks(s);
    return s;
}

/**
 * Walk the markdown line-by-line tracking fence depth. When we see
 * an opening fence with no language tag (just bare `\`\`\``), insert
 * a language inferred from the first non-blank content line of the
 * fence. Closing fences are left alone.
 *
 * Inference falls back to `text` when nothing matches, which is
 * always a valid tag and keeps the validator happy without lying
 * about the content.
 */
export function repairBareCodeFences(body: string): string {
    const lines = body.split(/\r?\n/u);
    const out: string[] = [];
    let i = 0;
    // Match either ` or ~ fence runs (>=3) optionally followed by an info string.
    const fenceRegex = /^(\s*)(`{3,}|~{3,})(.*)$/u;
    while (i < lines.length) {
        const line = lines[i]!;
        const fence = fenceRegex.exec(line);
        if (!fence) {
            out.push(line);
            i++;
            continue;
        }
        const indent = fence[1] ?? "";
        const marker = fence[2] ?? "```";
        const existingTag = (fence[3] ?? "").trim();

        // Find the matching closing fence: same marker character and
        // length >= opener. Mismatched fences (different char, shorter
        // run) are content per CommonMark.
        const markerChar = marker.charAt(0);
        const markerLen = marker.length;
        const closerRegex = new RegExp(
            `^\\s*${markerChar === "`" ? "`" : "~"}{${markerLen},}\\s*$`,
            "u",
        );
        let j = i + 1;
        while (j < lines.length && !closerRegex.test(lines[j]!)) {
            j++;
        }
        const contentLines = lines.slice(i + 1, j);

        if (existingTag.length === 0) {
            const lang = inferFenceLanguage(contentLines);
            out.push(`${indent}${marker}${lang}`);
        } else {
            out.push(line);
        }
        for (const c of contentLines) out.push(c);
        if (j < lines.length) {
            out.push(lines[j]!);
            i = j + 1;
        } else {
            // Unterminated fence — stop. Validator will still flag the
            // shape but at least the opener now has a language tag.
            i = j;
        }
    }
    return out.join("\n");
}

/**
 * Infer a fence language from the first non-blank line of content.
 * Conservative — defaults to `text` when no signal is found. Order
 * matters: more specific patterns come first.
 */
function inferFenceLanguage(contentLines: string[]): string {
    const first = contentLines.find((l) => l.trim().length > 0)?.trim();
    if (!first) return "text";

    if (/^[{[]/u.test(first)) return "json";
    if (/^</u.test(first)) return "html";
    if (/^#!\s*\/.*\b(bash|sh|zsh)\b/u.test(first)) return "bash";
    if (/^\$\s/u.test(first) || /^>\s/u.test(first)) return "bash";

    const firstToken = first.split(/\s+/u, 1)[0] ?? "";
    if (
        /^(pnpm|npm|yarn|node|deno|bun|cd|ls|mkdir|rm|cp|mv|export|set|git|curl|wget|echo|cat|sudo|brew|apt|choco|winget|docker|kubectl)$/u.test(
            firstToken,
        )
    ) {
        return "bash";
    }
    if (
        /^(import|export|const|let|var|function|class|interface|type|async|await|enum|namespace|return|throw|try|if|for|while|switch)$/u.test(
            firstToken,
        )
    ) {
        return "ts";
    }
    if (/^\/\//u.test(first)) return "ts";
    if (/^#\s/u.test(first)) return "bash";

    return "text";
}

/**
 * Convert any markdown reference that the validator would flag as an
 * "absolute URL" into a non-link form that preserves the human-
 * readable text:
 *
 *   `[Discord Developer Portal](https://discord.com/developers)`
 *     → `Discord Developer Portal`
 *   `<https://aka.ms/foo>` → `` `https://aka.ms/foo` ``
 *
 * Bare URLs in plain prose or inside inline code are left alone —
 * the validator is also being relaxed to permit them. The model is
 * instructed to favour repo-relative paths but legitimate setup
 * references to external sites (Discord developer portal, Microsoft
 * sign-in URLs, etc.) are useful and shouldn't trigger a retry.
 */
export function repairAbsoluteLinks(body: string): string {
    // Pass 1: drop the `[text](https://...)` wrapper, keep visible text.
    // Use the linear-time link parser so the rewrite is bounded by
    // input size even on adversarial sequences of brackets.
    const matches = parseInlineLinks(body).filter((m) =>
        isAbsoluteHttpUrl(m.target),
    );
    let s = body;
    for (let k = matches.length - 1; k >= 0; k--) {
        const m = matches[k]!;
        s = s.slice(0, m.start) + m.text + s.slice(m.end);
    }
    // Pass 2: autolink `<http(s)://...>` → wrap in inline code so it's
    // still readable but no longer matches `<...>` syntax. The
    // negated class excludes `<`, `>`, and whitespace so the regex
    // engine cannot backtrack across nested or pathological inputs.
    s = s.replace(
        /<(https?:\/\/[^>\s<\n]{1,2048})>/giu,
        (_m, url: string) => `\`${url}\``,
    );
    return s;
}

function isAbsoluteHttpUrl(target: string): boolean {
    return /^https?:\/\//iu.test(target);
}

/**
 * Demote any H1 (`# Heading`) to H2 (`## Heading`) outside fenced
 * code blocks. The validator forbids H1s anywhere in the body
 * because the file's title is appended deterministically.
 *
 * Why a repair: some packages' hand-written READMEs start with
 * `# Title` and the LLM mirrors that pattern even after being told
 * not to. Demoting to H2 is mechanical, lossless, and keeps the
 * section content intact rather than burning a retry attempt.
 *
 * Lines inside fenced code blocks are left alone — `# foo` there is
 * a shell comment, not a heading.
 */
export function repairH1Headings(body: string): string {
    const lines = body.split(/\r?\n/u);
    walkLinesWithFences(body, (line, idx, state) => {
        if (state.isFence || state.inFence) return;
        // Match `# ` exactly (single hash + space), not `## `, `### `, etc.
        if (/^#\s/u.test(line)) {
            lines[idx] = `#${line}`;
        }
    });
    return lines.join("\n");
}

/**
 * Strip markdown links of the form `[anything](./README.md)` to the
 * plain visible text. The AUTOGEN file's header banner already
 * provides the canonical pointer to `./README.md` (when one exists),
 * so body-level self-references add noise and frequently break for
 * packages that have no `README.md` at all.
 *
 * Lines inside fenced code blocks are left alone so the repair
 * doesn't munge sample markdown shown in code samples.
 */
export function repairSelfReadmeLinks(body: string): string {
    const lines = body.split(/\r?\n/u);
    walkLinesWithFences(body, (line, idx, state) => {
        if (state.isFence || state.inFence) return;
        const matches = parseInlineLinks(line);
        if (matches.length === 0) return;
        let rebuilt = line;
        for (let k = matches.length - 1; k >= 0; k--) {
            const m = matches[k]!;
            if (m.target !== "./README.md") continue;
            rebuilt = rebuilt.slice(0, m.start) + m.text + rebuilt.slice(m.end);
        }
        lines[idx] = rebuilt;
    });
    return lines.join("\n");
}
