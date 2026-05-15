// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A markdown link extracted from a document.
 */
export interface ExtractedLink {
    /** The visible text inside [...]. */
    readonly text: string;
    /** The link target inside (...) — never URL-decoded. */
    readonly target: string;
    /** 1-based line number of the link in the source. */
    readonly line: number;
}

/**
 * Mask inline code spans (`...`, ``...``, ```...```) on a single line
 * by replacing their interior with spaces. Backtick *runs* match: an
 * opener of N backticks closes on the next run of exactly N
 * backticks. Lines are considered independently because inline code
 * spans cannot cross a newline per CommonMark. Outside runs (and any
 * unterminated opener at end-of-line) are left intact.
 *
 * Used by repair / extraction / strip passes that walk markdown line
 * by line and need to ignore link-shaped content that is in fact a
 * literal inside an inline code span (e.g. a documentation example).
 */
export function maskInlineCode(line: string): string {
    let out = "";
    let i = 0;
    while (i < line.length) {
        if (line.charCodeAt(i) !== 0x60 /* ` */) {
            out += line.charAt(i);
            i++;
            continue;
        }
        // Count the run of backticks for the opener.
        let runLen = 0;
        while (
            i + runLen < line.length &&
            line.charCodeAt(i + runLen) === 0x60
        ) {
            runLen++;
        }
        // Find a closer of the same length.
        let j = i + runLen;
        let closerStart = -1;
        while (j < line.length) {
            if (line.charCodeAt(j) === 0x60) {
                let closerLen = 0;
                while (
                    j + closerLen < line.length &&
                    line.charCodeAt(j + closerLen) === 0x60
                ) {
                    closerLen++;
                }
                if (closerLen === runLen) {
                    closerStart = j;
                    break;
                }
                j += closerLen;
            } else {
                j++;
            }
        }
        if (closerStart < 0) {
            // Unterminated opener — leave the rest of the line alone.
            out += line.slice(i);
            return out;
        }
        // Keep the backticks themselves so character offsets are
        // preserved; mask only the interior with spaces.
        out += line.slice(i, i + runLen);
        out += " ".repeat(closerStart - (i + runLen));
        out += line.slice(closerStart, closerStart + runLen);
        i = closerStart + runLen;
    }
    return out;
}
/**
 * A single inline-link match inside a markdown string.
 *
 * Returned by `parseInlineLinks`. Offsets are 0-based and refer to
 * the original string the parser was called with — useful when
 * callers need to splice or replace individual matches in place.
 */
export interface InlineLinkMatch {
    /** The full matched substring `[text](target)` or `[text](target "title")`. */
    readonly fullMatch: string;
    /** Visible link text (between `[` and `]`). */
    readonly text: string;
    /** Link target (inside parentheses, before any `"title"`). */
    readonly target: string;
    /** Optional title inside `"..."`; undefined if absent. */
    readonly title: string | undefined;
    /** Index of the leading `[`. */
    readonly start: number;
    /** Index just past the trailing `)`. */
    readonly end: number;
}

/**
 * Parse every inline markdown link `[text](target[ "title"])` in the
 * supplied string. Single forward pass with `String#indexOf` — runs
 * in linear time on input length, no regex backtracking. Safe for
 * adversarial inputs (e.g. LLM output containing pathological
 * sequences of `[[[[(((` characters).
 *
 * Limitations (intentional, kept simple):
 *   - Reference-style links `[text][id]` are NOT matched.
 *   - Nested square brackets in `text` are NOT supported (the first
 *     `]` after `[` closes the text).
 *   - Target may not contain whitespace nor `)` (must be percent-encoded).
 *   - Title (if present) is the substring inside the first matched
 *     `"..."` after the target; nested quotes are not supported.
 */
export function parseInlineLinks(s: string): InlineLinkMatch[] {
    const out: InlineLinkMatch[] = [];
    let i = 0;
    while (i < s.length) {
        const lb = s.indexOf("[", i);
        if (lb < 0) break;
        const rb = s.indexOf("]", lb + 1);
        if (rb < 0) break;
        if (s.charCodeAt(rb + 1) !== 0x28 /* ( */) {
            i = lb + 1;
            continue;
        }
        const lp = rb + 1;
        const rp = s.indexOf(")", lp + 1);
        if (rp < 0) break;
        const inner = s.slice(lp + 1, rp);
        const wsIdx = firstAsciiWhitespace(inner);
        let target: string;
        let title: string | undefined;
        if (wsIdx < 0) {
            target = inner;
            title = undefined;
        } else {
            target = inner.slice(0, wsIdx);
            const rest = inner.slice(wsIdx);
            // Strip leading whitespace deterministically (no regex).
            let r = 0;
            while (r < rest.length) {
                const c = rest.charCodeAt(r);
                if (c !== 0x20 && c !== 0x09) break;
                r++;
            }
            const afterWs = rest.slice(r);
            // Match the original regex's strict "title-or-bust" rule:
            // anything after target whitespace must be a quoted title
            // running exactly to the closing paren. Otherwise the
            // whole construct is rejected as not a valid inline link.
            if (
                afterWs.length >= 2 &&
                afterWs.charCodeAt(0) === 0x22 /* " */ &&
                afterWs.charCodeAt(afterWs.length - 1) === 0x22
            ) {
                const interior = afterWs.slice(1, -1);
                if (!interior.includes('"')) {
                    title = interior;
                } else {
                    i = lb + 1;
                    continue;
                }
            } else {
                i = lb + 1;
                continue;
            }
        }
        if (target.length === 0 || firstAsciiWhitespace(target) >= 0) {
            i = lb + 1;
            continue;
        }
        out.push({
            fullMatch: s.slice(lb, rp + 1),
            text: s.slice(lb + 1, rb),
            target,
            title,
            start: lb,
            end: rp + 1,
        });
        i = rp + 1;
    }
    return out;
}

function firstAsciiWhitespace(s: string): number {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) return i;
    }
    return -1;
}

/**
 * Targets we never attempt to validate against the filesystem.
 * Anchor-only links (`#section`) and protocol-bearing URLs are
 * intentionally allowed — the AUTOGEN block restricts external links
 * via separate policy, but link extraction is non-judgemental.
 */
function isFilesystemLink(target: string): boolean {
    if (target.length === 0) return false;
    if (target.startsWith("#")) return false;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) return false; // any scheme://
    return true;
}

/**
 * Extract every inline markdown link `[text](target)` from `markdown`.
 * Links inside fenced code blocks (``` ... ```) are skipped, since
 * those represent example code not navigation.
 *
 * Reference-style links (`[text][id]` + `[id]: target`) are
 * intentionally NOT extracted — the AUTOGEN format spec uses inline
 * links only. Documents authored outside the bot may use the
 * reference style; those links are not the bot's responsibility.
 */
export function extractMarkdownLinks(markdown: string): ExtractedLink[] {
    const lines = markdown.split(/\r?\n/u);
    const out: ExtractedLink[] = [];
    let inFence = false;
    let fenceMarker = "";
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        const trimmed = raw.trim();
        const fenceMatch = /^(```|~~~)/u.exec(trimmed);
        if (fenceMatch !== null) {
            const marker = fenceMatch[1]!;
            if (!inFence) {
                inFence = true;
                fenceMarker = marker;
            } else if (trimmed.startsWith(fenceMarker)) {
                inFence = false;
                fenceMarker = "";
            }
            continue;
        }
        if (inFence) continue;
        // Mask inline code spans before scanning so literal
        // `[x](path)` examples in prose are not extracted as real links.
        const masked = maskInlineCode(raw);
        for (const match of parseInlineLinks(masked)) {
            out.push({
                text: match.text,
                target: match.target,
                line: i + 1,
            });
        }
    }
    return out.filter((l) => isFilesystemLink(l.target));
}
