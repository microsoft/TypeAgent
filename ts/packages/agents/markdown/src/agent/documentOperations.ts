// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Applies DocumentOperation values against the raw Markdown *string*, using
// character offsets into that string. This module is the authoritative
// applier for both the headless path (no view process) and for the
// server-authoritative apply in the view process. Callers computed the
// offsets against the same raw Markdown they read via getDocumentContent
// and paired the apply with the SHA-256 of that base content, so the
// service rejects the apply when the current Markdown hashes differently.

import type {
    ContentItem,
    DocumentOperation,
    MarkItem,
} from "./markdownOperationSchema.js";

export function applyDocumentOperations(
    content: string,
    operations: DocumentOperation[],
): string {
    return operations.reduce(
        (updatedContent, operation) =>
            applyDocumentOperation(updatedContent, operation),
        content,
    );
}

function applyDocumentOperation(
    content: string,
    operation: DocumentOperation,
): string {
    switch (operation.type) {
        case "insert": {
            const position = clampPosition(operation.position, content.length);
            return (
                content.slice(0, position) +
                contentItemsToText(operation.content) +
                content.slice(position)
            );
        }
        case "replace": {
            const [from, to] = clampRange(
                operation.from,
                operation.to,
                content.length,
            );
            return (
                content.slice(0, from) +
                contentItemsToText(operation.content) +
                content.slice(to)
            );
        }
        case "delete": {
            const [from, to] = clampRange(
                operation.from,
                operation.to,
                content.length,
            );
            return content.slice(0, from) + content.slice(to);
        }
        case "format": {
            const [from, to] = clampRange(
                operation.from,
                operation.to,
                content.length,
            );
            return operation.add
                ? addFormatMarks(content, from, to, operation.marks)
                : removeFormatMarks(content, from, to, operation.marks);
        }
    }
}

function contentItemsToText(items: ContentItem[]): string {
    return items.map((item) => contentItemToText(item)).join("");
}

function contentItemToText(item: ContentItem): string {
    const text = getPlainText(item);
    switch (item.type) {
        case "heading": {
            if (/^#{1,6}\s/.test(text)) {
                return ensureBlockSeparator(text);
            }
            const attrs = item.attrs as { level?: number } | undefined;
            const requestedLevel = attrs?.level;
            const level =
                requestedLevel !== undefined &&
                Number.isInteger(requestedLevel) &&
                requestedLevel >= 1 &&
                requestedLevel <= 6
                    ? requestedLevel
                    : 1;
            return `${"#".repeat(level)} ${text}\n\n`;
        }
        case "paragraph":
            return ensureBlockSeparator(text);
        case "bullet_list":
            return serializeList(item, "-");
        case "ordered_list":
            return serializeList(item, "1.");
        case "code_block":
            return `\`\`\`\n${text}\n\`\`\`\n\n`;
        case "blockquote":
            return `${text
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")}\n\n`;
        case "horizontal_rule":
            return "---\n\n";
        case "hard_break":
            return "  \n";
        case "text":
            return applyMarks(text, item);
        default:
            return text;
    }
}

function getPlainText(item: ContentItem): string {
    if (item.text !== undefined) {
        return item.text;
    }
    return item.content ? item.content.map(getPlainText).join("") : "";
}

function ensureBlockSeparator(text: string): string {
    return text.endsWith("\n\n") ? text : `${text}\n\n`;
}

function serializeList(item: ContentItem, marker: string): string {
    const lines =
        item.content?.map(
            (child) => `${marker} ${getPlainText(child).trim()}`,
        ) ?? [];
    return `${lines.join("\n")}\n\n`;
}

function applyMarks(text: string, item: ContentItem): string {
    return (item.marks ?? []).reduce(
        (markedText, mark) => wrapWithMark(markedText, mark),
        text,
    );
}

// Markdown wrapper for a single MarkItem. `symmetric` marks use identical left
// and right delimiters and, for removal, may also accept a set of alternate
// GFM-valid delimiters (e.g. `_em_` and `__strong__`). `code` marks use a
// backtick run chosen at wrap time so a run inside the selected text can
// never terminate the span, plus code-span padding when the content begins
// or ends with a backtick or spaces. `link` marks emit `[text](href)`; when
// the LLM did not supply `attrs.href` the mark is dropped so we never emit
// a link with an empty target.
type SymmetricMarkWrapper = {
    kind: "symmetric";
    delimiter: string;
    alternates?: readonly string[];
};
type MarkWrapper =
    | SymmetricMarkWrapper
    | { kind: "code" }
    | { kind: "link"; href: string };

function markWrapper(mark: MarkItem): MarkWrapper | undefined {
    switch (mark.type) {
        case "strong":
            return {
                kind: "symmetric",
                delimiter: "**",
                alternates: ["__"],
            };
        case "em":
            return {
                kind: "symmetric",
                delimiter: "*",
                alternates: ["_"],
            };
        case "code":
            return { kind: "code" };
        case "link": {
            const attrs = mark.attrs as { href?: string } | undefined;
            if (!attrs?.href) {
                return undefined;
            }
            return { kind: "link", href: attrs.href };
        }
        default:
            return undefined;
    }
}

// Pick the shortest backtick run strictly longer than any run already in
// `text`. That is the canonical CommonMark rule: no interior run can close
// the span, so a selection containing "`" gets wrapped in "``", "``" in
// "```", and so on.
function codeSpanDelimiter(text: string): string {
    const runs = text.match(/`+/g);
    let longest = 0;
    if (runs) {
        for (const run of runs) {
            if (run.length > longest) {
                longest = run.length;
            }
        }
    }
    return "`".repeat(longest + 1);
}

// CommonMark code-span padding: add a single space on each side when the
// content begins or ends with a backtick, so the delimiter run and the
// interior can be told apart by a reader. Also pad when the content is
// entirely spaces so the span is not read as empty. We deliberately do
// NOT pad on plain leading/trailing spaces alone, because those are
// semantic content the user selected.
function shouldPadCodeSpan(text: string): boolean {
    if (text.length === 0) {
        return false;
    }
    if (text.startsWith("`") || text.endsWith("`")) {
        return true;
    }
    if (/^ +$/.test(text)) {
        return true;
    }
    return false;
}

function wrapCodeSpan(text: string): string {
    const delimiter = codeSpanDelimiter(text);
    const padded = shouldPadCodeSpan(text) ? ` ${text} ` : text;
    return `${delimiter}${padded}${delimiter}`;
}

function wrapWithMark(text: string, mark: MarkItem): string {
    const wrapper = markWrapper(mark);
    if (wrapper === undefined) {
        return text;
    }
    switch (wrapper.kind) {
        case "symmetric":
            return `${wrapper.delimiter}${text}${wrapper.delimiter}`;
        case "code":
            return wrapCodeSpan(text);
        case "link":
            return `[${text}](${wrapper.href})`;
    }
}

// Add the requested marks around content[from..to]. Marks are applied
// innermost-first to match applyMarks so `[strong, em]` produces
// `*<strong>text</strong>*`. An empty range or an empty marks list is a
// no-op so callers don't have to guard.
function addFormatMarks(
    content: string,
    from: number,
    to: number,
    marks: MarkItem[],
): string {
    if (marks.length === 0 || from === to) {
        return content;
    }
    const wrapped = marks.reduce(
        (text, mark) => wrapWithMark(text, mark),
        content.slice(from, to),
    );
    return content.slice(0, from) + wrapped + content.slice(to);
}

// Remove the requested marks by peeling matching Markdown delimiters that
// immediately surround content[from..to]. Marks are processed
// innermost-first so `[strong, em]` correctly peels `*` then `**` off
// `*<strong>text</strong>*`. A mark whose delimiter is not present at the
// current boundary is silently skipped, so remove is idempotent when the
// user asked to strip formatting that was never applied.
type Boundaries = { leftPos: number; rightPos: number };

function removeFormatMarks(
    content: string,
    from: number,
    to: number,
    marks: MarkItem[],
): string {
    if (marks.length === 0 || from === to) {
        return content;
    }
    let leftPos = from;
    let rightPos = to;
    for (const mark of marks) {
        const wrapper = markWrapper(mark);
        if (wrapper === undefined) {
            continue;
        }
        const peeled = peelMarkWrapper(content, leftPos, rightPos, wrapper);
        if (peeled !== undefined) {
            leftPos = peeled.leftPos;
            rightPos = peeled.rightPos;
        }
    }
    return (
        content.slice(0, leftPos) +
        content.slice(from, to) +
        content.slice(rightPos)
    );
}

function peelMarkWrapper(
    content: string,
    leftPos: number,
    rightPos: number,
    wrapper: MarkWrapper,
): Boundaries | undefined {
    switch (wrapper.kind) {
        case "symmetric":
            return peelSymmetricDelimiter(content, leftPos, rightPos, wrapper);
        case "code":
            return peelCodeSpan(content, leftPos, rightPos);
        case "link":
            return peelLink(content, leftPos, rightPos);
    }
}

// Peel a symmetric delimiter (or one of its alternates) that surrounds
// content[leftPos..rightPos]. Preferring the canonical delimiter keeps
// existing tests deterministic while still accepting the GFM alternates
// (`__` and `_`) the LLM may emit alongside `**` and `*`.
function peelSymmetricDelimiter(
    content: string,
    leftPos: number,
    rightPos: number,
    wrapper: SymmetricMarkWrapper,
): Boundaries | undefined {
    const candidates = [wrapper.delimiter, ...(wrapper.alternates ?? [])];
    for (const delimiter of candidates) {
        if (isSurroundedBy(content, leftPos, rightPos, delimiter)) {
            return {
                leftPos: leftPos - delimiter.length,
                rightPos: rightPos + delimiter.length,
            };
        }
    }
    return undefined;
}

function isSurroundedBy(
    content: string,
    leftPos: number,
    rightPos: number,
    delimiter: string,
): boolean {
    return (
        leftPos >= delimiter.length &&
        content.slice(leftPos - delimiter.length, leftPos) === delimiter &&
        rightPos + delimiter.length <= content.length &&
        content.slice(rightPos, rightPos + delimiter.length) === delimiter
    );
}

// Peel the outer code-span delimiters and the optional CommonMark
// single-space padding. The delimiter length is discovered from the
// actual backtick run rather than hard-coded, so any pair emitted by
// wrapCodeSpan (`` ` ``, `` `` ``, `` ``` ``, ...) can be undone.
// Padding must be symmetric or absent: wrapCodeSpan only emits both
// spaces together, so an unbalanced pattern is not something we wrote
// and we leave it alone.
function peelCodeSpan(
    content: string,
    leftPos: number,
    rightPos: number,
): Boundaries | undefined {
    const left = stripCodeSpanPad(content, leftPos, -1);
    const right = stripCodeSpanPad(content, rightPos, 1);
    if (left.padded !== right.padded) {
        return undefined;
    }
    const runLength = countRun(content, left.pos, "`", -1);
    if (runLength === 0) {
        return undefined;
    }
    if (countRun(content, right.pos, "`", 1) !== runLength) {
        return undefined;
    }
    return {
        leftPos: left.pos - runLength,
        rightPos: right.pos + runLength,
    };
}

// Consume a single optional space adjacent to `pos`. `direction` is -1 for
// the left boundary (checking content[pos - 1]) and 1 for the right
// boundary (checking content[pos]).
function stripCodeSpanPad(
    content: string,
    pos: number,
    direction: -1 | 1,
): { pos: number; padded: boolean } {
    if (direction === -1) {
        if (pos >= 1 && content[pos - 1] === " ") {
            return { pos: pos - 1, padded: true };
        }
    } else {
        if (pos < content.length && content[pos] === " ") {
            return { pos: pos + 1, padded: true };
        }
    }
    return { pos, padded: false };
}

// Count consecutive occurrences of `char` starting from `pos`, walking
// left (direction -1) or right (direction 1). Used to discover the actual
// backtick-run length on each side of a code span.
function countRun(
    content: string,
    pos: number,
    char: string,
    direction: -1 | 1,
): number {
    let count = 0;
    if (direction === -1) {
        while (pos - (count + 1) >= 0 && content[pos - (count + 1)] === char) {
            count += 1;
        }
    } else {
        while (pos + count < content.length && content[pos + count] === char) {
            count += 1;
        }
    }
    return count;
}

// Peel a link wrapper `[text](href)`. Expect `[` immediately before
// leftPos and `](...)` starting at rightPos. Only peel when the full
// pattern is present; malformed links are left alone.
function peelLink(
    content: string,
    leftPos: number,
    rightPos: number,
): Boundaries | undefined {
    if (
        leftPos < 1 ||
        content[leftPos - 1] !== "[" ||
        content[rightPos] !== "]" ||
        content[rightPos + 1] !== "("
    ) {
        return undefined;
    }
    const closeParen = content.indexOf(")", rightPos + 2);
    if (closeParen === -1) {
        return undefined;
    }
    return { leftPos: leftPos - 1, rightPos: closeParen + 1 };
}

function clampPosition(position: number, contentLength: number): number {
    if (!Number.isInteger(position) || position < 0) {
        throw new Error(`Invalid document position: ${position}`);
    }
    return Math.min(position, contentLength);
}

function clampRange(
    from: number,
    to: number,
    contentLength: number,
): [number, number] {
    if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < from
    ) {
        throw new Error(`Invalid document range: ${from}-${to}`);
    }
    return [Math.min(from, contentLength), Math.min(to, contentLength)];
}
