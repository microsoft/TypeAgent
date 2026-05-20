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
});
