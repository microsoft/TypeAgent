// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { SymbolKind } from "vscode-languageserver/node.js";
import { computeDocumentSymbols } from "../src/features/symbols.js";

function doc(text: string): TextDocument {
    return TextDocument.create("file:///t.wf", "workflow", 1, text);
}

describe("document symbols", () => {
    it("returns workflow with params and top-level constants", () => {
        const src = `
workflow myFlow(a: string, b: number): string {
    const x = a;
    const y = string.join([a], ",");
    return y;
}
`;
        const symbols = computeDocumentSymbols(doc(src));
        expect(symbols.length).toBe(1);
        const wf = symbols[0]!;
        expect(wf.name).toBe("myFlow");
        expect(wf.kind).toBe(SymbolKind.Function);

        const childNames = wf.children!.map((c) => c.name).sort();
        expect(childNames).toEqual(["a", "b", "x", "y"]);

        const xSym = wf.children!.find((c) => c.name === "x")!;
        expect(xSym.kind).toBe(SymbolKind.Constant);

        const aSym = wf.children!.find((c) => c.name === "a")!;
        expect(aSym.kind).toBe(SymbolKind.Variable);
    });

    it("returns no symbols when the document has no valid workflow", () => {
        // Pure garbage — lexer fails on the unterminated string.
        expect(computeDocumentSymbols(doc('"unterminated'))).toEqual([]);
    });

    it("surfaces DestructuringConst entries", () => {
        const src = `
workflow w(): string {
    const [a, b] = someCall();
    return a;
}
`;
        const symbols = computeDocumentSymbols(doc(src));
        const wf = symbols[0]!;
        const destructure = wf.children!.find((c) =>
            c.name.includes("{ a, b }"),
        );
        expect(destructure).toBeDefined();
    });

    it("returns every workflow in a multi-workflow file in source order", () => {
        const src = `workflow alpha(a: string): string {
    const x = a;
    return x;
}
workflow beta(b: number): string {
    const y = b;
    return "ok";
}
`;
        const symbols = computeDocumentSymbols(doc(src));
        expect(symbols.map((s) => s.name)).toEqual(["alpha", "beta"]);
        // Each workflow carries its own params/locals; they are not
        // pooled into the first workflow.
        const alphaChildren = symbols[0]!.children!.map((c) => c.name).sort();
        const betaChildren = symbols[1]!.children!.map((c) => c.name).sort();
        expect(alphaChildren).toEqual(["a", "x"]);
        expect(betaChildren).toEqual(["b", "y"]);
    });
});
