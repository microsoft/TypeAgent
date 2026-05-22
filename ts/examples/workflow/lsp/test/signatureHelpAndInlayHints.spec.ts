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

    it("clamps activeParameter to the last available parameter", () => {
        // list.length has exactly 1 parameter; cursor after 2 commas clamps to 0.
        const text = `workflow w(): integer {\n    return list.length([], [], );\n}`;
        const d = doc(text);
        const line1 = text.split("\n")[1]!;
        const col = line1.lastIndexOf(",") + 2;
        const help = computeSignatureHelp(
            d,
            { line: 1, character: col },
            schemas,
        );
        expect(help).not.toBeNull();
        expect(help!.activeParameter).toBe(0);
    });

    it("ignores a // comment containing a ( when locating the active call", () => {
        // The `(` inside the comment must not be counted as an unclosed paren.
        const text = `workflow w(): string {\n    // comment with ( stray paren\n    return string.join(["a"], ",");\n}`;
        const d = doc(text);
        const line2 = text.split("\n")[2]!;
        const col = line2.indexOf("(") + 2; // inside first arg
        const help = computeSignatureHelp(
            d,
            { line: 2, character: col },
            schemas,
        );
        expect(help).not.toBeNull();
        expect(help!.signatures[0]!.label).toContain("string.join");
        expect(help!.activeParameter).toBe(0);
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

    it("emits a hint for non-task-call bindings with inferred type", () => {
        const text = `workflow w(): string {\n    const s = "hi";\n    return s;\n}`;
        const hints = computeInlayHints(doc(text), schemas);
        // const s = "hi" -> s inferred as string, hint should be `: string`
        expect(hints.length).toBe(1);
        expect(hints[0]!.label as string).toBe(": string");
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

    it("excludes hints that fall before the requested range", () => {
        // Const binding is on line 1; range starts at line 2 — hint excluded.
        const text = `workflow w(): integer {\n    const n = list.length([1, 2, 3]);\n    return n;\n}`;
        const hints = computeInlayHints(doc(text), schemas, {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 20 },
        });
        expect(hints.length).toBe(0);
    });

    it("does not emit a hint for a synthetic (bare-call) const", () => {
        // Bare task calls get isSynthetic:true and must be skipped.
        const text = `workflow w(): string {\n    shell.exec("echo hi");\n    return "done";\n}`;
        const hints = computeInlayHints(doc(text), schemas);
        expect(hints.length).toBe(0);
    });

    it("traverses switch statement body and default_ to emit hints", () => {
        const text = `workflow w(x: string): integer {\n    switch (x) {\n        case "a": {\n            const n = list.length(["a"]);\n            return n;\n        }\n        default: {\n            const m = list.length(["b", "c"]);\n            return m;\n        }\n    }\n}`;
        const hints = computeInlayHints(doc(text), schemas);
        // One hint per case-arm const binding (n and m).
        expect(hints.length).toBeGreaterThanOrEqual(2);
    });
});
