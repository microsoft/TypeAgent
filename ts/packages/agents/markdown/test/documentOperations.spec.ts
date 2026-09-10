// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { applyDocumentOperations } from "../src/agent/documentOperations.js";
import type { DocumentOperation } from "../src/agent/markdownOperationSchema.js";

describe("base-relative DocumentOperation batches", () => {
    test("applies length-changing operations without shifting later offsets", () => {
        const before =
            "# Title\n\nAlpha paragraph.\n\nBravo paragraph.\n\nCharlie paragraph.\n";
        const charlieStart = before.indexOf("Charlie");
        const operations: DocumentOperation[] = [
            {
                type: "insert",
                position: before.indexOf("Alpha"),
                content: [{ type: "text", text: "NEW INTRO\n\n" }],
            },
            {
                type: "delete",
                from: charlieStart,
                to: before.length,
            },
        ];

        expect(applyDocumentOperations(before, operations)).toBe(
            "# Title\n\nNEW INTRO\n\nAlpha paragraph.\n\nBravo paragraph.\n\n",
        );
    });

    test("preserves operation order for inserts at the same position", () => {
        const operations: DocumentOperation[] = [
            {
                type: "insert",
                position: 0,
                content: [{ type: "text", text: "first " }],
            },
            {
                type: "insert",
                position: 0,
                content: [{ type: "text", text: "second " }],
            },
        ];

        expect(applyDocumentOperations("body", operations)).toBe(
            "first second body",
        );
    });

    test("rejects overlapping operations", () => {
        const operations: DocumentOperation[] = [
            { type: "delete", from: 0, to: 4 },
            {
                type: "replace",
                from: 2,
                to: 6,
                content: [{ type: "text", text: "updated" }],
            },
        ];

        expect(() => applyDocumentOperations("content", operations)).toThrow(
            "Document operations must not overlap",
        );
    });
});

describe("insert and replace content serialization", () => {
    test.each(["insert", "replace"] as const)(
        "preserves marks on nested content for %s operations",
        (type) => {
            const content = [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "Hello " },
                        {
                            type: "text",
                            text: "world",
                            marks: [{ type: "strong" }, { type: "em" }],
                        },
                    ],
                },
            ];
            const operation: DocumentOperation =
                type === "insert"
                    ? { type, position: 0, content }
                    : { type, from: 0, to: 3, content };

            expect(applyDocumentOperations("old", [operation])).toBe(
                "Hello ***world***\n\n" + (type === "insert" ? "old" : ""),
            );
        },
    );

    test("separates a horizontal rule from preceding text", () => {
        const operation: DocumentOperation = {
            type: "insert",
            position: 6,
            content: [{ type: "horizontal_rule" }],
        };

        expect(applyDocumentOperations("Hello\n", [operation])).toBe(
            "Hello\n\n---\n\n",
        );
    });
});

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

    test("does not remove em from strong text", () => {
        const before = "hello **world**";
        const op: DocumentOperation = {
            type: "format",
            from: 8,
            to: 13,
            add: false,
            marks: [{ type: "em" }],
        };

        expect(applyDocumentOperations(before, [op])).toBe(before);
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

    test("removes a link whose destination contains parentheses", () => {
        const before = "click [here](https://example.com/a(b))";
        const op: DocumentOperation = {
            type: "format",
            from: 7,
            to: 11,
            add: false,
            marks: [
                {
                    type: "link",
                    attrs: { href: "https://example.com/a(b)" },
                },
            ],
        };
        expect(applyDocumentOperations(before, [op])).toBe("click here");
    });

    test("does not remove a link with a different destination", () => {
        const before = "click [here](https://example.com/one)";
        const op: DocumentOperation = {
            type: "format",
            from: 7,
            to: 11,
            add: false,
            marks: [
                {
                    type: "link",
                    attrs: { href: "https://example.com/two" },
                },
            ],
        };
        expect(applyDocumentOperations(before, [op])).toBe(before);
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
