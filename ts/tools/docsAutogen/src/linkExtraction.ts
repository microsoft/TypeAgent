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
        linkRegex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = linkRegex.exec(raw)) !== null) {
            out.push({
                text: m[1] ?? "",
                target: m[2] ?? "",
                line: i + 1,
            });
        }
    }
    return out.filter((l) => isFilesystemLink(l.target));
}
