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
    // Inline link pattern. The target group avoids unescaped parentheses
    // in the URL (which the markdown spec disallows for inline links
    // without escaping).
    const linkRegex = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
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
        linkRegex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = linkRegex.exec(masked)) !== null) {
            out.push({
                text: m[1] ?? "",
                target: m[2] ?? "",
                line: i + 1,
            });
        }
    }
    return out.filter((l) => isFilesystemLink(l.target));
}
