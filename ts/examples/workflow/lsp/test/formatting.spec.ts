// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import {
    formatDocument,
    formatDocumentRange,
} from "../src/features/formatting.js";

function doc(text: string): TextDocument {
    return TextDocument.create("file:///t.wf", "workflow", 1, text);
}

describe("formatting", () => {
    it("produces a full-document edit for badly-spaced source", () => {
        const src = `workflow w(  x:string  ):string{const y=x;return y;}`;
        const edits = formatDocument(doc(src));
        expect(edits.length).toBe(1);
        const newText = edits[0]!.newText;
        // Formatted output must lex+parse without errors.
        expect(newText).toContain("workflow w(x: string): string");
    });

    it("returns no edits when source is already canonical", () => {
        const canonical =
            "workflow w(x: string): string {\n" +
            "    const y = x;\n" +
            "    return y;\n" +
            "}\n";
        const edits = formatDocument(doc(canonical));
        expect(edits).toEqual([]);
    });

    it("returns no edits on parse error (preserves source)", () => {
        const src = `workflow broken( {`;
        const edits = formatDocument(doc(src));
        expect(edits).toEqual([]);
    });
});

describe("formatDocumentRange", () => {
    const UNFORMATTED = `workflow w(  x:string  ):string{const y=x;return y;}`;

    it("returns edits when the requested range overlaps the document", () => {
        const edits = formatDocumentRange(doc(UNFORMATTED), {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 20 },
        });
        expect(edits.length).toBe(1);
    });

    it("returns no edits when the requested range is beyond the document", () => {
        // Document is one line (line 0); a range at line 100 cannot overlap.
        const edits = formatDocumentRange(doc(UNFORMATTED), {
            start: { line: 100, character: 0 },
            end: { line: 101, character: 0 },
        });
        expect(edits).toEqual([]);
    });

    it("returns no edits on parse error even with an overlapping range", () => {
        const edits = formatDocumentRange(doc(`workflow broken( {`), {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 10 },
        });
        expect(edits).toEqual([]);
    });
});

describe("formatting — multi-workflow", () => {
    it("formats every workflow in a multi-workflow file", () => {
        const src = `workflow a(  x:string  ):string{const y=x;return y;}\nworkflow b(  n:integer  ):integer{const m=n;return m;}\n`;
        const edits = formatDocument(doc(src));
        expect(edits.length).toBe(1);
        const newText = edits[0]!.newText;
        // Both workflows must appear in the formatted output, each with
        // canonical spacing — a single-workflow formatter would emit
        // only the first one.
        expect(newText).toContain("workflow a(x: string): string");
        expect(newText).toContain("workflow b(n: integer): integer");
    });

    it("returns no edits when a multi-workflow file is already canonical", () => {
        const canonical =
            "workflow a(x: string): string {\n" +
            "    const y = x;\n" +
            "    return y;\n" +
            "}\n" +
            "\n" +
            "workflow b(n: integer): integer {\n" +
            "    const m = n;\n" +
            "    return m;\n" +
            "}\n";
        expect(formatDocument(doc(canonical))).toEqual([]);
    });
});
