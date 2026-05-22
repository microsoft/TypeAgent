// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { computePrepareRename, computeRename } from "../src/features/rename.js";
import { clearCache } from "../src/parsedDocument.js";

beforeEach(() => clearCache());

function doc(text: string): TextDocument {
    return TextDocument.create("file:///t.wf", "workflow", 1, text);
}

const SRC = `workflow w(a: string, b: number): string {
    const x = a;
    return x;
}`;

describe("prepareRename", () => {
    it("returns the range of a param at its declaration", () => {
        // 'a' declared at line 0, col 11 (0-based).
        const r = computePrepareRename(doc(SRC), {
            line: 0,
            character: 11,
        });
        expect(r).not.toBeNull();
        expect(r!.start.line).toBe(0);
        expect(r!.start.character).toBe(11);
        expect(r!.end.character).toBe(12);
    });

    it("returns the range of a param at a reference site", () => {
        // 'a' referenced at line 1, col 14 (0-based) inside 'const x = a;'.
        const r = computePrepareRename(doc(SRC), {
            line: 1,
            character: 14,
        });
        expect(r).not.toBeNull();
        expect(r!.start.line).toBe(1);
        expect(r!.start.character).toBe(14);
    });

    it("returns null for unresolved positions", () => {
        const r = computePrepareRename(doc(SRC), { line: 0, character: 0 });
        expect(r).toBeNull();
    });
});

describe("rename", () => {
    it("renames declaration plus all references", () => {
        const edit = computeRename(
            doc(SRC),
            { line: 0, character: 11 },
            "alpha",
        );
        expect(edit).not.toBeNull();
        const edits = edit!.changes!["file:///t.wf"]!;
        // 1 declaration + 1 reference for 'a'.
        expect(edits.length).toBe(2);
        for (const e of edits) {
            expect(e.newText).toBe("alpha");
        }
    });

    it("renames from a reference site too", () => {
        const edit = computeRename(
            doc(SRC),
            { line: 1, character: 14 },
            "beta",
        );
        expect(edit).not.toBeNull();
        const edits = edit!.changes!["file:///t.wf"]!;
        expect(edits.length).toBe(2);
    });

    it("rejects invalid identifiers", () => {
        const edit = computeRename(
            doc(SRC),
            { line: 0, character: 11 },
            "123bad",
        );
        expect(edit).toBeNull();
    });

    it("returns null for unresolved positions", () => {
        const edit = computeRename(
            doc(SRC),
            { line: 0, character: 0 },
            "alpha",
        );
        expect(edit).toBeNull();
    });

    it("renames a const binding and its uses", () => {
        const text = `workflow w(): string {\n    const x = "hi";\n    return x;\n}`;
        // 'x' decl at line 1, col 10 (0-based)
        const edit = computeRename(doc(text), { line: 1, character: 10 }, "y");
        expect(edit).not.toBeNull();
        const edits = edit!.changes!["file:///t.wf"]!;
        // 1 decl + 1 ref
        expect(edits.length).toBe(2);
    });

    it("rejects an empty new name", () => {
        const edit = computeRename(doc(SRC), { line: 0, character: 11 }, "");
        expect(edit).toBeNull();
    });

    it("accepts a single underscore as a valid identifier", () => {
        const edit = computeRename(doc(SRC), { line: 0, character: 11 }, "_");
        expect(edit).not.toBeNull();
    });

    it("rejects a name containing a space", () => {
        const edit = computeRename(
            doc(SRC),
            { line: 0, character: 11 },
            "my name",
        );
        expect(edit).toBeNull();
    });

    it("rejects a name starting with a digit", () => {
        const edit = computeRename(
            doc(SRC),
            { line: 0, character: 11 },
            "2fast",
        );
        expect(edit).toBeNull();
    });

    it("throws when new name conflicts with an existing symbol", () => {
        const text = `workflow w(): string {\n    const x = "a";\n    const y = "b";\n    return x;\n}`;
        // rename 'x' to 'y' - conflict
        expect(() =>
            computeRename(doc(text), { line: 1, character: 10 }, "y"),
        ).toThrow();
    });
});

// Phase 4c: prepare-rename on a keyword should return null.
// Phase 4d: prepare-rename on a built-in task name should return null.
describe("prepareRename - non-renameable positions", () => {
    it("returns null when cursor is on the 'const' keyword (not a user symbol)", () => {
        const src = `workflow w(): string {\n    const x = "hi";\n    return x;\n}`;
        // Line 1, char 4 = 'c' in "    const ..."
        const r = computePrepareRename(doc(src), { line: 1, character: 4 });
        expect(r).toBeNull();
    });

    it("returns null on a built-in task call name (not user-defined)", () => {
        const src = `workflow w(a: string): string {\n    const x = a;\n    return string.join([x], ",");\n}`;
        // Line 2: "    return string.join..." — 'string.join' starts at char 11
        const col = "    return ".length; // 11
        const r = computePrepareRename(doc(src), { line: 2, character: col });
        expect(r).toBeNull();
    });
});
