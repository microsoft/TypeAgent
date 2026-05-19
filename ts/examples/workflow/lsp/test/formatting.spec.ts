// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { formatDocument } from "../src/features/formatting.js";

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
