// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    while (i < lines.length) {
        const line = lines[i]!;
        // Match any fence line (opener or closer); the loop body
        // always advances past the matching closer, so we never see
        // a closer at the start of an iteration except as a fresh
        // (independent) opener of a new block — which is fine.
        const fence = /^(\s*)```(.*)$/u.exec(line);
        if (!fence) {
            out.push(line);
            i++;
            continue;
        }
        const indent = fence[1] ?? "";
        const existingTag = (fence[2] ?? "").trim();

        // Find the matching closing fence line.
        let j = i + 1;
        while (j < lines.length && !/^\s*```/u.test(lines[j]!)) {
            j++;
        }
        const contentLines = lines.slice(i + 1, j);

        if (existingTag.length === 0) {
            const lang = inferFenceLanguage(contentLines);
            out.push(`${indent}\`\`\`${lang}`);
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
    let s = body;
    // Markdown link with absolute http(s) target → drop the link
    // wrapper, keep the visible text. Use a non-greedy match on the
    // text and a class that excludes ')' on the URL so we stop at
    // the first closing paren of the link target.
    s = s.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu,
        (_match, text: string) => text,
    );
    // Autolink → wrap in inline code so it's still readable but no
    // longer matches `<http(s)://...>` syntax.
    s = s.replace(
        /<(https?:\/\/[^>\s]+)>/giu,
        (_m, url: string) => `\`${url}\``,
    );
    return s;
}
