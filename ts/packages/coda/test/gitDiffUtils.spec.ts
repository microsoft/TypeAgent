// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    MAX_DIFF_FILES,
    MAX_FILE_PATCH_BYTES,
    MAX_SECTION_PATCH_BYTES,
    boundPatchText,
    isBinaryDiffText,
    parseDiffBlock,
    parseUnifiedDiff,
} from "../src/gitDiffUtils.js";

test("boundPatchText returns text unchanged when under the byte budget", () => {
    const [text, bytes, truncated] = boundPatchText("hello", 100);
    assert.equal(text, "hello");
    assert.equal(bytes, 5);
    assert.equal(truncated, false);
});

test("boundPatchText truncates at the byte budget and reports truncation", () => {
    const [text, bytes, truncated] = boundPatchText("0123456789", 4);
    assert.equal(text, "0123");
    assert.equal(bytes, 4);
    assert.equal(truncated, true);
});

test("boundPatchText drops a trailing multi-byte character split by the byte budget", () => {
    // "é" is 2 bytes in UTF-8; a 1-byte budget can't fit it, so it should be
    // dropped entirely rather than emitting a corrupt/replacement character.
    const [text, bytes, truncated] = boundPatchText("é", 1);
    assert.equal(text, "");
    assert.equal(bytes, 0);
    assert.equal(truncated, true);
});

test("boundPatchText keeps a complete multi-byte character that fits exactly", () => {
    const [text, bytes, truncated] = boundPatchText("aé", 3);
    assert.equal(text, "aé");
    assert.equal(bytes, 3);
    assert.equal(truncated, false);
});

test("isBinaryDiffText detects the standard git binary-diff marker", () => {
    assert.equal(
        isBinaryDiffText("Binary files a/img.png and b/img.png differ\n"),
        true,
    );
});

test("isBinaryDiffText detects GIT binary patch payloads", () => {
    assert.equal(
        isBinaryDiffText("diff --git a/x b/x\nGIT binary patch\nliteral 10\n"),
        true,
    );
});

test("isBinaryDiffText returns false for a normal text patch", () => {
    assert.equal(
        isBinaryDiffText("diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n"),
        false,
    );
});

test("parseDiffBlock identifies a modified file", () => {
    const block = [
        "diff --git a/src/foo.ts b/src/foo.ts",
        "index 111..222 100644",
        "--- a/src/foo.ts",
        "+++ b/src/foo.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, "src/foo.ts");
    assert.equal(entry.oldPath, undefined);
    assert.equal(entry.status, "modified");
    assert.equal(entry.binary, false);
    assert.equal(entry.patch, block);
});

test("parseDiffBlock identifies a new (added) file", () => {
    const block = [
        "diff --git a/src/new.ts b/src/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1 @@",
        "+content",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.status, "added");
    assert.equal(entry.oldPath, undefined);
});

test("parseDiffBlock identifies a deleted file", () => {
    const block = [
        "diff --git a/src/gone.ts b/src/gone.ts",
        "deleted file mode 100644",
        "--- a/src/gone.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-content",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.status, "deleted");
});

test("parseDiffBlock identifies a rename and reports the old path", () => {
    const block = [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 100%",
        "rename from src/old.ts",
        "rename to src/new.ts",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.status, "renamed");
    assert.equal(entry.path, "src/new.ts");
    assert.equal(entry.oldPath, "src/old.ts");
});

test("parseDiffBlock identifies a copy and reports the source path", () => {
    const block = [
        "diff --git a/src/orig.ts b/src/copy.ts",
        "similarity index 100%",
        "copy from src/orig.ts",
        "copy to src/copy.ts",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.status, "copied");
    assert.equal(entry.oldPath, "src/orig.ts");
});

test("parseDiffBlock marks binary diffs and omits patch text", () => {
    const block = [
        "diff --git a/img.png b/img.png",
        "index 111..222 100644",
        "Binary files a/img.png and b/img.png differ",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.binary, true);
    assert.equal(entry.patch, undefined);
});

test("parseDiffBlock returns undefined for text with no diff --git header", () => {
    assert.equal(parseDiffBlock("not a diff at all"), undefined);
});

test("parseUnifiedDiff returns an empty section for empty text", () => {
    const section = parseUnifiedDiff("");
    assert.deepEqual(section, {
        files: [],
        filesTruncated: false,
        patchTruncated: false,
    });
});

test("parseUnifiedDiff splits multiple file blocks and preserves order", () => {
    const text = [
        "diff --git a/a.ts b/a.ts",
        "index 1..2 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "-a",
        "+a2",
        "diff --git a/b.ts b/b.ts",
        "index 3..4 100644",
        "--- a/b.ts",
        "+++ b/b.ts",
        "@@ -1 +1 @@",
        "-b",
        "+b2",
        "",
    ].join("\n");
    const section = parseUnifiedDiff(text);
    assert.equal(section.files.length, 2);
    assert.equal(section.files[0].path, "a.ts");
    assert.equal(section.files[1].path, "b.ts");
    assert.equal(section.filesTruncated, false);
    assert.equal(section.patchTruncated, false);
});

test("parseUnifiedDiff caps per-file patch bytes and reports patchTruncated", () => {
    const bigLine = "+".concat("x".repeat(MAX_FILE_PATCH_BYTES + 1000));
    const text = [
        "diff --git a/big.ts b/big.ts",
        "index 1..2 100644",
        "--- a/big.ts",
        "+++ b/big.ts",
        "@@ -1 +1 @@",
        bigLine,
        "",
    ].join("\n");
    const section = parseUnifiedDiff(text);
    assert.equal(section.files.length, 1);
    assert.equal(section.patchTruncated, true);
    assert.ok(
        Buffer.byteLength(section.files[0].patch ?? "", "utf8") <=
            MAX_FILE_PATCH_BYTES,
    );
});

test("parseUnifiedDiff caps the total section byte budget across many files", () => {
    // Each file's patch is small individually (well under the per-file cap)
    // but there are enough of them to blow through the shared section budget.
    const perFileBytes = 500;
    const fileCount = Math.ceil(MAX_SECTION_PATCH_BYTES / perFileBytes) + 5;
    const blocks: string[] = [];
    for (let i = 0; i < fileCount; i++) {
        blocks.push(
            [
                `diff --git a/f${i}.ts b/f${i}.ts`,
                "index 1..2 100644",
                "--- a/f" + i + ".ts",
                "+++ b/f" + i + ".ts",
                "@@ -1 +1 @@",
                "+" + "x".repeat(perFileBytes),
                "",
            ].join("\n"),
        );
    }
    const section = parseUnifiedDiff(blocks.join(""));
    assert.equal(section.patchTruncated, true);
    // Total bytes actually kept across all patches should not exceed the
    // shared section budget (a small header/margin is allowed).
    const totalPatchBytes = section.files.reduce(
        (sum, f) => sum + Buffer.byteLength(f.patch ?? "", "utf8"),
        0,
    );
    assert.ok(totalPatchBytes <= MAX_SECTION_PATCH_BYTES);
});

test("parseUnifiedDiff caps the number of files and reports filesTruncated", () => {
    const blocks: string[] = [];
    for (let i = 0; i < MAX_DIFF_FILES + 1; i++) {
        blocks.push(`diff --git a/f${i}.ts b/f${i}.ts\nindex 1..2 100644\n`);
    }
    const text = blocks.join("");
    const section = parseUnifiedDiff(text);
    assert.equal(section.files.length, MAX_DIFF_FILES);
    assert.equal(section.filesTruncated, true);
});

test("parseDiffBlock unquotes a C-escaped non-ASCII header path", () => {
    // git quotes a path (independently on each side) whenever it contains a
    // non-ASCII UTF-8 byte, which is the default for accented/CJK/emoji
    // filenames (core.quotepath=true). "café.txt" is octal-escaped as
    // \303\251 (UTF-8 for "é").
    const block = [
        'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
        "index 111..222 100644",
        '--- "a/caf\\303\\251.txt"',
        '+++ "b/caf\\303\\251.txt"',
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, "café.txt");
    assert.equal(entry.status, "modified");
});

test("parseDiffBlock unquotes a rename with a mixed quoted/unquoted header", () => {
    // A rename from an ASCII to a non-ASCII name quotes only the side that
    // needs it, and the from/to paths themselves are also independently
    // quoted only when needed.
    const block = [
        'diff --git a/old.txt "b/caf\\303\\251 new.txt"',
        "similarity index 100%",
        "rename from old.txt",
        'rename to "caf\\303\\251 new.txt"',
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.status, "renamed");
    assert.equal(entry.path, "café new.txt");
    assert.equal(entry.oldPath, "old.txt");
});

test("parseDiffBlock unquotes a header path with a literal (unescaped) non-ASCII character", () => {
    // With core.quotepath=false, a path is still quoted when it contains a
    // structural character needing a C escape (e.g. a literal double quote),
    // but any non-ASCII bytes appear literally rather than octal-escaped.
    // Unescaped characters must round-trip as themselves, not be
    // mis-decoded as raw UTF-8 bytes (e.g. "é" mistaken for byte 0xE9).
    const block = [
        'diff --git "a/caf\\"é.txt" "b/caf\\"é.txt"',
        "index 111..222 100644",
        '--- "a/caf\\"é.txt"',
        '+++ "b/caf\\"é.txt"',
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, 'caf"é.txt');
    assert.equal(entry.status, "modified");
});

test("parseDiffBlock handles an unquoted (ASCII) path containing a space", () => {
    // Real git appends a bare trailing tab to `---`/`+++` lines whenever the
    // path contains a literal space (a unified-diff convention disambiguating
    // the filename from a would-be timestamp) -- confirmed against real
    // `git diff` output on a scratch repo. That tab must not become part of
    // the reported path.
    const block = [
        "diff --git a/my file.txt b/my file.txt",
        "index 111..222 100644",
        "--- a/my file.txt\t",
        "+++ b/my file.txt\t",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, "my file.txt");
    assert.equal(entry.status, "modified");
});

test("parseDiffBlock strips the trailing tab from a quoted, space-containing path", () => {
    // When a spaced path also needs C-quoting (e.g. it's also non-ASCII),
    // git's disambiguating tab is appended *after* the closing quote --
    // confirmed against real `git diff` output.
    const block = [
        'diff --git "a/caf\\303\\251 space.txt" "b/caf\\303\\251 space.txt"',
        "index 111..222 100644",
        '--- "a/caf\\303\\251 space.txt"\t',
        '+++ "b/caf\\303\\251 space.txt"\t',
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, "café space.txt");
    assert.equal(entry.status, "modified");
});

test("parseDiffBlock does not add a trailing tab to rename from/to lines", () => {
    // Confirmed against real `git diff` output: unlike ---/+++, rename
    // from/to lines never get the disambiguating tab even for spaced paths.
    const block = [
        "diff --git a/old name.txt b/new name.txt",
        "similarity index 100%",
        "rename from old name.txt",
        "rename to new name.txt",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.status, "renamed");
    assert.equal(entry.path, "new name.txt");
    assert.equal(entry.oldPath, "old name.txt");
});

test("parseDiffBlock unquotes a binary-diff header with a non-ASCII name (no ---/+++ lines)", () => {
    // A binary diff has neither ---/+++ nor rename/copy lines, so the path
    // must come from the combined "diff --git" header; both sides are
    // always the same path here (a rename would emit rename from/to
    // instead), and the quoted form must still be unquoted correctly.
    const block = [
        'diff --git "a/bild\\303\\244.bin" "b/bild\\303\\244.bin"',
        "index 111..222 100644",
        "Binary files a/bildä.bin and b/bildä.bin differ",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, "bildä.bin");
    assert.equal(entry.binary, true);
    assert.equal(entry.patch, undefined);
});

test("parseDiffBlock unquotes a mode-only-change header with a non-ASCII name", () => {
    const block = [
        'diff --git "a/caf\\303\\251.sh" "b/caf\\303\\251.sh"',
        "old mode 100644",
        "new mode 100755",
        "",
    ].join("\n");
    const entry = parseDiffBlock(block);
    assert.ok(entry);
    assert.equal(entry.path, "café.sh");
    assert.equal(entry.status, "modified");
});

test("parseUnifiedDiff reports filesUnparsed for a block it cannot recover a path from", () => {
    // A block with a header but no rename/copy/---/+++ lines and no
    // "a/X b/Y" (or quoted) split possible is dropped, but counted rather
    // than silently vanishing from the result.
    const text = [
        "diff --git a/normal.ts b/normal.ts",
        "index 1..2 100644",
        "--- a/normal.ts",
        "+++ b/normal.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git weird-no-ab-split",
        "old mode 100644",
        "",
    ].join("\n");
    const section = parseUnifiedDiff(text);
    assert.equal(section.files.length, 1);
    assert.equal(section.files[0].path, "normal.ts");
    assert.equal(section.filesUnparsed, 1);
});
