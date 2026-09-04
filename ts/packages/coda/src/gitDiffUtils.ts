// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pure, vscode-independent Git diff parsing/formatting helpers used by
// getGitDiff (see handleReadActions.ts). Kept free of any "vscode" import so
// they can be unit tested directly (with tsx --test) without the VS Code
// extension host.

import { StringDecoder } from "node:string_decoder";

// Output bounds for getGitDiff. Real repos can have arbitrarily large diffs;
// these caps keep the ActionResult message small enough to round-trip over
// the WebSocket and fit in a reasoning agent's context, with explicit
// truncation metadata rather than silently dropping content.
export const MAX_DIFF_FILES = 200;
export const MAX_FILE_PATCH_BYTES = 20_000;
export const MAX_SECTION_PATCH_BYTES = 100_000;

export type DiffFileEntry = {
    path: string;
    oldPath?: string;
    status: string;
    binary: boolean;
    patch?: string;
};

export type DiffSection = {
    files: DiffFileEntry[];
    filesTruncated: boolean;
    patchTruncated: boolean;
    // Count of files omitted because they fall outside every open workspace
    // folder (only set, and only > 0, when that filtering actually dropped
    // something -- see handleReadActions.ts). Absent otherwise.
    filesOutsideWorkspace?: number;
    // Count of "diff --git" blocks that failed to parse (e.g. an unexpected
    // header shape) and were dropped rather than silently omitted with no
    // trace. Absent when every block parsed successfully.
    filesUnparsed?: number;
};

// Truncate patch text to at most maxBytes (UTF-8), returning the possibly-
// truncated text, the number of bytes it consumed, and whether it was cut.
// Uses StringDecoder rather than a raw byte slice so a cut that lands in the
// middle of a multi-byte character drops that trailing partial character
// instead of decoding it into a U+FFFD replacement character (which would
// also make the reported byte count wrong, since re-encoding U+FFFD is 3
// bytes even when only 1 byte of the original sequence was kept).
export function boundPatchText(
    text: string,
    maxBytes: number,
): [text: string, bytes: number, truncated: boolean] {
    const encoded = Buffer.from(text, "utf8");
    if (encoded.length <= maxBytes) {
        return [text, encoded.length, false];
    }
    const decoder = new StringDecoder("utf8");
    const truncated = decoder.write(encoded.subarray(0, maxBytes));
    return [truncated, Buffer.byteLength(truncated, "utf8"), true];
}

export function isBinaryDiffText(text: string): boolean {
    return (
        /^Binary files .* differ/m.test(text) ||
        text.includes("GIT binary patch")
    );
}

// Split raw unified-diff text into per-file blocks (on "diff --git "
// headers). Exported so callers can filter/inspect blocks (e.g. workspace
// containment in handleReadActions.ts) before/independent of parseUnifiedDiff.
export function splitDiffBlocks(text: string): string[] {
    if (!text) {
        return [];
    }
    return text.split(/(?=^diff --git )/m).filter((block) => block.length > 0);
}

// Parse the raw unified-diff text returned by repo.diff() into per-file
// entries. Files are split on "diff --git " headers; status/binary/rename
// are inferred from the standard git diff header lines since diff() (unlike
// diffWith()) does not return a separate Change[] with status codes.
export function parseUnifiedDiff(text: string): DiffSection {
    const blocks = splitDiffBlocks(text);
    const filesTruncated = blocks.length > MAX_DIFF_FILES;
    const limitedBlocks = blocks.slice(0, MAX_DIFF_FILES);
    let remaining = MAX_SECTION_PATCH_BYTES;
    let patchTruncated = false;
    let filesUnparsed = 0;
    const files: DiffFileEntry[] = [];
    for (const block of limitedBlocks) {
        const entry = parseDiffBlock(block);
        if (!entry) {
            filesUnparsed++;
            continue;
        }
        if (!entry.binary && entry.patch) {
            if (remaining <= 0) {
                delete entry.patch;
                patchTruncated = true;
            } else {
                const [boundedText, usedBytes, wasTruncated] = boundPatchText(
                    entry.patch,
                    Math.min(MAX_FILE_PATCH_BYTES, remaining),
                );
                entry.patch = boundedText;
                remaining -= usedBytes;
                if (wasTruncated) {
                    patchTruncated = true;
                }
            }
        }
        files.push(entry);
    }
    return {
        files,
        filesTruncated,
        patchTruncated,
        ...(filesUnparsed > 0 && { filesUnparsed }),
    };
}

// Confirms a block is a valid diff block (just checks for the header
// prefix; the two paths on this line are not reliably separable when an
// unquoted, plain-ASCII path contains a literal space, so actual path
// extraction uses the single-path-per-line forms below instead).
const DIFF_HEADER_RE = /^diff --git /m;
const LEGACY_HEADER_PATH_RE = /^diff --git a\/(.*) b\/(.*)$/m;

const GIT_QUOTE_ESCAPES: Record<string, number> = {
    "\\": 0x5c,
    '"': 0x22,
    a: 0x07,
    b: 0x08,
    f: 0x0c,
    n: 0x0a,
    r: 0x0d,
    t: 0x09,
    v: 0x0b,
};

// Reverse git's diff-header path quoting. By default (core.quotepath=true,
// the git default) any path containing a non-ASCII UTF-8 byte -- i.e. any
// accented, CJK, or emoji filename -- is wrapped in double quotes with each
// non-printable/high-bit byte octal-escaped (`\NNN`), plus the usual C
// escapes (`\\`, `\"`, `\t`, ...). Without unquoting these, such paths fail
// to match and the file is silently dropped from the diff. `inner` must
// NOT include the surrounding quotes.
//
// A path can also be quoted for reasons other than non-ASCII bytes (e.g. it
// contains a literal `"` or tab) while `core.quotepath=false` is set, in
// which case any non-ASCII characters appear *unescaped* inside the quotes
// -- already-decoded JS string characters, not raw bytes. Octal/C escapes
// are collected as raw bytes (they may be a multi-byte UTF-8 sequence split
// across several `\NNN` escapes) and decoded as UTF-8 once flushed; any
// unescaped character is appended to the result as-is instead, so a
// surrogate pair for a character outside the BMP round-trips unchanged.
function unquoteGitHeaderPath(inner: string): string {
    let result = "";
    let byteBuffer: number[] = [];
    const flushBytes = () => {
        if (byteBuffer.length > 0) {
            result += Buffer.from(byteBuffer).toString("utf8");
            byteBuffer = [];
        }
    };
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch !== "\\" || i + 1 >= inner.length) {
            if (ch.charCodeAt(0) > 0x7f) {
                flushBytes();
                result += ch;
            } else {
                byteBuffer.push(ch.charCodeAt(0));
            }
            continue;
        }
        const octal = inner.slice(i + 1, i + 4);
        if (/^[0-7]{3}$/.test(octal)) {
            byteBuffer.push(parseInt(octal, 8));
            i += 3;
            continue;
        }
        const escaped = GIT_QUOTE_ESCAPES[inner[i + 1]];
        if (escaped !== undefined) {
            byteBuffer.push(escaped);
            i += 1;
            continue;
        }
        // Unrecognized escape: keep the backslash literally; the next
        // character is processed on its own next iteration.
        byteBuffer.push(ch.charCodeAt(0));
    }
    flushBytes();
    return result;
}

// Extract the path from a single diff header line matched by `lineRe` (must
// have exactly one capture group spanning the rest of the line). Handles
// both the quoted (C-escaped) and bare forms, and returns undefined for a
// missing line or the `/dev/null` sentinel.
function extractHeaderLinePath(
    block: string,
    lineRe: RegExp,
): string | undefined {
    const match = lineRe.exec(block);
    if (!match) {
        return undefined;
    }
    // Git appends a bare trailing tab to a `---`/`+++` path that contains a
    // literal space (the classic unified-diff convention for disambiguating
    // the filename from a would-be timestamp) -- after the closing quote
    // for a quoted path. Strip it before the quote check below: a real
    // trailing-tab byte in a filename is always quoted with the tab
    // C-escaped as `\t` *inside* the quotes, so a bare trailing tab here is
    // unambiguously this disambiguator, never part of the path itself.
    // (`rename from`/`rename to`/`copy from`/`copy to` never get this tab,
    // but stripping a tab that isn't there is a no-op, so this is safe for
    // every caller.)
    const raw = match[1].endsWith("\t") ? match[1].slice(0, -1) : match[1];
    if (raw === "/dev/null") {
        return undefined;
    }
    if (raw.startsWith('"') && raw.endsWith('"')) {
        return unquoteGitHeaderPath(raw.slice(1, -1));
    }
    return raw;
}

function stripPrefix(value: string, prefix: string): string;
function stripPrefix(
    value: string | undefined,
    prefix: string,
): string | undefined;
function stripPrefix(
    value: string | undefined,
    prefix: string,
): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

const RENAME_FROM_RE = /^rename from (.+)$/m;
const RENAME_TO_RE = /^rename to (.+)$/m;
const COPY_FROM_RE = /^copy from (.+)$/m;
const COPY_TO_RE = /^copy to (.+)$/m;
const MINUS_RE = /^--- (.+)$/m;
const PLUS_RE = /^\+\+\+ (.+)$/m;

// Parse a single "diff --git a/... b/..." block into a DiffFileEntry. Paths
// are read from the single-path-per-line rename/copy/---/+++ header lines
// (each independently quoted only when needed) rather than the combined
// "diff --git a/X b/Y" line, since that line is ambiguous to split when an
// unquoted (plain-ASCII) path contains a literal space.
export function parseDiffBlock(block: string): DiffFileEntry | undefined {
    if (!DIFF_HEADER_RE.test(block)) {
        return undefined;
    }
    const isRename = /^rename from /m.test(block);
    const isCopy = /^copy from /m.test(block);
    const isNew =
        /^new file mode /m.test(block) || /^--- \/dev\/null/m.test(block);
    const isDeleted =
        /^deleted file mode /m.test(block) ||
        /^\+\+\+ \/dev\/null/m.test(block);

    let path: string | undefined;
    let oldPath: string | undefined;
    if (isRename || isCopy) {
        oldPath = extractHeaderLinePath(
            block,
            isRename ? RENAME_FROM_RE : COPY_FROM_RE,
        );
        path = extractHeaderLinePath(
            block,
            isRename ? RENAME_TO_RE : COPY_TO_RE,
        );
    }
    // ---/+++ lines are present for any block with an actual content diff
    // (including a rename-with-changes), and are the unambiguous source for
    // the current path when a rename/copy had no from/to lines to fall back
    // on (they always do, but this keeps the two sources consistent).
    path =
        path ??
        stripPrefix(extractHeaderLinePath(block, PLUS_RE), "b/") ??
        stripPrefix(extractHeaderLinePath(block, MINUS_RE), "a/");
    if (path === undefined) {
        // Rare fallback: a binary-diff or mode-only-change block has
        // neither ---/+++ nor rename/copy lines (a rename/copy always
        // emits "rename to"/"copy to", handled above). Both sides of the
        // combined "diff --git a/X b/Y" header are therefore always the
        // same path here, so extract it by finding where the first
        // (quoted-or-not) path ends rather than trying to split two
        // independently-quoted paths apart.
        const quoted = /^diff --git "((?:\\.|[^"\\])*)"/m.exec(block);
        if (quoted) {
            path = stripPrefix(unquoteGitHeaderPath(quoted[1]), "a/");
        } else {
            const legacy = LEGACY_HEADER_PATH_RE.exec(block);
            if (!legacy) {
                return undefined;
            }
            path = legacy[2];
        }
    }

    let status: string;
    if (isRename) {
        status = "renamed";
    } else if (isCopy) {
        status = "copied";
    } else if (isNew) {
        status = "added";
    } else if (isDeleted) {
        status = "deleted";
    } else {
        status = "modified";
    }
    const binary = isBinaryDiffText(block);
    return {
        path,
        ...(oldPath !== undefined && { oldPath }),
        status,
        binary,
        ...(!binary && { patch: block }),
    };
}
