// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface Line {
    text: string;
    start: number;
    end: number;
    fenced: boolean;
}

interface Heading {
    title: string;
    level: number;
    line: number;
}

function markdownHeading(
    text: string,
): { title: string; level: number } | undefined {
    const marker = /^ {0,3}(#{1,6})\s/.exec(text);
    if (!marker) return undefined;
    let title = text.slice(marker[0].length).trim();
    let end = title.length;
    while (end > 0 && title[end - 1] === "#") end--;
    if (end > 0 && end < title.length && /\s/.test(title[end - 1]))
        title = title.slice(0, end).trimEnd();
    return { title, level: marker[1].length };
}

export function scanMarkdownStructure(content: string): {
    lines: Line[];
    headings: Heading[];
} {
    const lines: Line[] = [];
    const headings: Heading[] = [];
    let fence: { character: string; length: number } | undefined;
    let frontmatter =
        content.startsWith("---\n") || content.startsWith("---\r");
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    for (const match of content.matchAll(pattern)) {
        if (!match[0]) break;
        const text = match[0].replace(/\r?\n$|\r$/, "");
        const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(text);
        const fenced = fence !== undefined || marker !== null;
        if (marker) {
            if (!fence)
                fence = { character: marker[1][0], length: marker[1].length };
            else if (
                marker[1][0] === fence.character &&
                marker[1].length >= fence.length &&
                !marker[2].trim()
            )
                fence = undefined;
        }
        if (frontmatter && lines.length > 0 && text === "---") {
            frontmatter = false;
        } else if (!frontmatter && !fenced) {
            const heading = markdownHeading(text);
            if (heading) headings.push({ ...heading, line: lines.length });
        }
        lines.push({
            text,
            start: match.index,
            end: match.index + match[0].length,
            fenced,
        });
    }
    return { lines, headings };
}
