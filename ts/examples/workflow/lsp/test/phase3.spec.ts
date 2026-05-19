// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { computeSignatureHelp } from "../src/features/signatureHelp.js";
import { computeInlayHints } from "../src/features/inlayHints.js";
import { loadTaskSchemas } from "../src/taskSchemas.js";
import { clearCache } from "../src/parsedDocument.js";

const schemas = loadTaskSchemas();

beforeEach(() => clearCache());

function doc(text: string): TextDocument {
    return TextDocument.create("file:///t.wf", "workflow", 1, text);
}

describe("signature help", () => {
    it("returns the signature when cursor sits inside a task call", () => {
        // string.join is a real builtin: (list, separator)
        const text = `workflow w(): string {\n    return string.join(["a"], );\n}`;
        // Position just before the closing paren on line 1.
        const d = doc(text);
        const lineText = text.split("\n")[1]!;
        const col = lineText.indexOf(", ") + 2; // after the comma, before ')'
        const help = computeSignatureHelp(
            d,
            { line: 1, character: col },
            schemas,
        );
        expect(help).not.toBeNull();
        expect(help!.signatures.length).toBe(1);
        expect(help!.signatures[0]!.label).toContain("string.join");
        expect(help!.activeParameter).toBe(1);
    });

    it("returns the first parameter when cursor is immediately after `(`", () => {
        const text = `workflow w(): string {\n    return string.join();\n}`;
        const d = doc(text);
        const lineText = text.split("\n")[1]!;
        const col = lineText.indexOf("(") + 1;
        const help = computeSignatureHelp(
            d,
            { line: 1, character: col },
            schemas,
        );
        expect(help).not.toBeNull();
        expect(help!.activeParameter).toBe(0);
    });

    it("returns null outside any call", () => {
        const text = `workflow w(): string {\n    return "x";\n}`;
        const help = computeSignatureHelp(
            doc(text),
            { line: 0, character: 0 },
            schemas,
        );
        expect(help).toBeNull();
    });

    it("returns null for unknown call names", () => {
        const text = `workflow w(): string {\n    return notATask( );\n}`;
        const d = doc(text);
        const col = text.split("\n")[1]!.indexOf("(") + 1;
        const help = computeSignatureHelp(
            d,
            { line: 1, character: col },
            schemas,
        );
        expect(help).toBeNull();
    });

    it("ignores commas inside string literals", () => {
        // The "," literal contains a comma that should NOT bump activeParameter.
        const text = `workflow w(): string {\n    return string.join(["a"], ",");\n}`;
        const d = doc(text);
        const lineText = text.split("\n")[1]!;
        const col = lineText.indexOf('","') + 3; // inside the second arg
        const help = computeSignatureHelp(
            d,
            { line: 1, character: col },
            schemas,
        );
        expect(help).not.toBeNull();
        expect(help!.activeParameter).toBe(1);
    });
});

describe("inlay hints", () => {
    it("emits an inferred-type hint after `const` names bound to task calls", () => {
        const text = `workflow w(): integer {\n    const n = list.length([1,2,3]);\n    return n;\n}`;
        const hints = computeInlayHints(doc(text), schemas);
        expect(hints.length).toBe(1);
        expect(hints[0]!.label).toContain("integer");
        expect(hints[0]!.position.line).toBe(1);
    });

    it("does not duplicate a hint when the source already declares a type", () => {
        const text = `workflow w(): integer {\n    const n: integer = list.length([1,2,3]);\n    return n;\n}`;
        const hints = computeInlayHints(doc(text), schemas);
        expect(hints.length).toBe(0);
    });

    it("emits nothing for non-task-call bindings", () => {
        const text = `workflow w(): string {\n    const s = "hi";\n    return s;\n}`;
        const hints = computeInlayHints(doc(text), schemas);
        expect(hints.length).toBe(0);
    });

    it("respects a requested range", () => {
        const text = `workflow w(): integer {\n    const a = list.length([1]);\n    const b = list.length([1,2]);\n    return a;\n}`;
        const all = computeInlayHints(doc(text), schemas);
        expect(all.length).toBe(2);
        // Only the second const should be in range.
        const limited = computeInlayHints(doc(text), schemas, {
            start: { line: 2, character: 0 },
            end: { line: 3, character: 0 },
        });
        expect(limited.length).toBe(1);
    });
});
