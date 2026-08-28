// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { applyDocumentOperations } from "../src/agent/documentOperations.js";
import type { DocumentOperation } from "../src/agent/markdownOperationSchema.js";

describe("format DocumentOperation", () => {
    test("adds strong marks around a character range", () => {
        const before = "hello world";
        const op: DocumentOperation = {
            type: "format",
            from: 6,
            to: 11,
            add: true,
            marks: [{ type: "strong" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("hello **world**");
    });

    test("adds nested em+strong innermost-first", () => {
        const before = "abc";
        const op: DocumentOperation = {
            type: "format",
            from: 0,
            to: 3,
            add: true,
            marks: [{ type: "strong" }, { type: "em" }],
        };
        // strong applied first (innermost), then em wraps: *<strong>abc</strong>*
        expect(applyDocumentOperations(before, [op])).toBe("***abc***");
    });

    test("adds code marks", () => {
        const before = "run cmd here";
        const op: DocumentOperation = {
            type: "format",
            from: 4,
            to: 7,
            add: true,
            marks: [{ type: "code" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("run `cmd` here");
    });

    test("adds code marks around selection containing a backtick using a longer delimiter", () => {
        // CommonMark code spans: choose a backtick run STRICTLY longer
        // than any run in the content, and pad with a single space when
        // the content begins or ends with a backtick, so removal can
        // symmetrically peel the emitted form back to the original.
        const before = "prefix `x suffix";
        const add: DocumentOperation = {
            type: "format",
            from: 7,
            to: 9,
            add: true,
            marks: [{ type: "code" }],
        };
        const wrapped = applyDocumentOperations(before, [add]);
        // Delimiter must be at least length 2 (content has a run of 1).
        expect(wrapped).toBe("prefix `` `x `` suffix");
        // Removal targets the CONTENT positions in the wrapped string
        // (matching how the strong/em `from/to` semantics work): the
        // content "`x" now sits at positions 10..12 in the wrapped
        // string. The peel walks outward through the padding and the
        // discovered backtick run so both delimiters and pads are
        // stripped symmetrically.
        const remove: DocumentOperation = {
            type: "format",
            from: 10,
            to: 12,
            add: false,
            marks: [{ type: "code" }],
        };
        expect(applyDocumentOperations(wrapped, [remove])).toBe(before);
    });

    test("adds a link when href is provided", () => {
        const before = "click here";
        const op: DocumentOperation = {
            type: "format",
            from: 6,
            to: 10,
            add: true,
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        };
        expect(applyDocumentOperations(before, [op])).toBe(
            "click [here](https://example.com)",
        );
    });

    test("drops a link mark with no href instead of emitting empty target", () => {
        const before = "click here";
        const op: DocumentOperation = {
            type: "format",
            from: 6,
            to: 10,
            add: true,
            marks: [{ type: "link", attrs: {} }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("click here");
    });

    test("removes strong marks around a character range", () => {
        const before = "hello **world**";
        const op: DocumentOperation = {
            type: "format",
            from: 8,
            to: 13,
            add: false,
            marks: [{ type: "strong" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("hello world");
    });

    test("removes nested marks innermost-first", () => {
        const before = "***abc***";
        const op: DocumentOperation = {
            type: "format",
            from: 3,
            to: 6,
            add: false,
            marks: [{ type: "strong" }, { type: "em" }],
        };
        // Peel ** first (matches inner **), then * around it: "abc"
        expect(applyDocumentOperations(before, [op])).toBe("abc");
    });

    test("removes a link", () => {
        const before = "click [here](https://example.com)";
        const op: DocumentOperation = {
            type: "format",
            from: 7,
            to: 11,
            add: false,
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("click here");
    });

    test("remove is idempotent when the delimiter is not present", () => {
        const before = "hello world";
        const op: DocumentOperation = {
            type: "format",
            from: 6,
            to: 11,
            add: false,
            marks: [{ type: "strong" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("hello world");
    });

    test("empty range is a no-op", () => {
        const before = "hello";
        const op: DocumentOperation = {
            type: "format",
            from: 2,
            to: 2,
            add: true,
            marks: [{ type: "strong" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("hello");
    });

    test("removes __strong__ alt-delimiter form", () => {
        const before = "hello __world__";
        const op: DocumentOperation = {
            type: "format",
            from: 8,
            to: 13,
            add: false,
            marks: [{ type: "strong" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("hello world");
    });

    test("removes _em_ alt-delimiter form", () => {
        const before = "hello _world_";
        const op: DocumentOperation = {
            type: "format",
            from: 7,
            to: 12,
            add: false,
            marks: [{ type: "em" }],
        };
        expect(applyDocumentOperations(before, [op])).toBe("hello world");
    });
});
