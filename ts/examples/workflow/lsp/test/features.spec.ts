// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { computeHover } from "../src/features/hover.js";
import { computeDefinition } from "../src/features/definition.js";
import { computeReferences } from "../src/features/references.js";
import { computeCompletions } from "../src/features/completion.js";
import { computeSemanticTokens } from "../src/features/semanticTokens.js";
import { loadTaskSchemas } from "../src/taskSchemas.js";
import { clearCache } from "../src/parsedDocument.js";

const schemas = loadTaskSchemas();

const SRC = `workflow w(a: string, b: number): string {
    const x = a;
    return string.join([x], ",");
}`;

function doc(text = SRC, version = 1): TextDocument {
    return TextDocument.create("file:///t.wf", "workflow", version, text);
}

beforeEach(() => clearCache());

describe("hover", () => {
    it("returns markdown for a param reference", () => {
        // 'a' is referenced at line 1 (0-based) col 14: `    const x = a;`
        const h = computeHover(doc(), { line: 1, character: 14 }, schemas);
        expect(h).not.toBeNull();
        const value = (h!.contents as { value: string }).value;
        // Expect TypeScript-style signature: (parameter) a: string
        expect(value).toContain("(parameter) a: string");
    });

    it("returns markdown for a builtin task", () => {
        // 'string.join' on line 2, starts at col 11
        const h = computeHover(doc(), { line: 2, character: 11 }, schemas);
        expect(h).not.toBeNull();
        const value = (h!.contents as { value: string }).value;
        expect(value).toContain("string.join");
        expect(value).toContain("built-in task");
    });

    it("returns null over whitespace", () => {
        expect(computeHover(doc(), { line: 0, character: 0 }, schemas)).toBe(
            null,
        );
    });

    it("returns hover at the declaration site of a const", () => {
        // Hovering at the 'x' in `const x = ...` should show the type.
        const h = computeHover(doc(), { line: 1, character: 10 }, schemas);
        expect(h).not.toBeNull();
        const value = (h!.contents as { value: string }).value;
        expect(value).toContain("const x");
    });

    it("task hover includes both input and output schema JSON", () => {
        // string.join on line 2, character 11
        const h = computeHover(doc(), { line: 2, character: 11 }, schemas);
        expect(h).not.toBeNull();
        const value = (h!.contents as { value: string }).value;
        expect(value).toContain("input:");
        expect(value).toContain("output:");
    });
});

describe("definition", () => {
    it("jumps from a reference to its declaration", () => {
        // 'a' reference at line 1, col 14 (0-based)
        const loc = computeDefinition(doc(), { line: 1, character: 14 });
        expect(loc).not.toBeNull();
        // Param 'a' is declared on line 0 inside `workflow w(a: string, ...)`
        expect(loc!.range.start.line).toBe(0);
    });

    it("returns null for unresolved names", () => {
        expect(computeDefinition(doc(), { line: 0, character: 0 })).toBeNull();
    });

    it("returns null when cursor is at the declaration itself", () => {
        // computeDefinition uses findReferenceAt which only searches refs.
        // The 'a' param at line 0 char 11 is a declaration, not a reference.
        expect(computeDefinition(doc(), { line: 0, character: 11 })).toBeNull();
    });
});

describe("references", () => {
    it("lists declaration + reference sites of a param", () => {
        // From the param 'a' declaration on line 0
        const refs = computeReferences(doc(), { line: 0, character: 11 }, true);
        expect(refs).not.toBeNull();
        expect(refs!.length).toBeGreaterThanOrEqual(2);
    });

    it("respects includeDeclaration=false", () => {
        const withDecl = computeReferences(
            doc(),
            { line: 0, character: 11 },
            true,
        )!;
        const withoutDecl = computeReferences(
            doc(),
            { line: 0, character: 11 },
            false,
        )!;
        expect(withoutDecl.length).toBe(withDecl.length - 1);
    });

    it("returns only the declaration when a const has no usage sites", () => {
        const src = `workflow w(): string {\n    const unused = "hi";\n    return "bye";\n}`;
        const d = doc(src);
        const line1 = src.split("\n")[1]!;
        const col = line1.indexOf("unused");
        const refs = computeReferences(d, { line: 1, character: col }, true);
        expect(refs).not.toBeNull();
        expect(refs!.length).toBe(1);
    });

    it("returns an empty array when unused const and includeDeclaration=false", () => {
        const src = `workflow w(): string {\n    const unused = "hi";\n    return "bye";\n}`;
        const d = doc(src);
        const line1 = src.split("\n")[1]!;
        const col = line1.indexOf("unused");
        const refs = computeReferences(d, { line: 1, character: col }, false);
        expect(refs).not.toBeNull();
        expect(refs!.length).toBe(0);
    });
});

describe("completion", () => {
    it("includes in-scope symbols and at least one builtin task", () => {
        const items = computeCompletions(doc(), schemas);
        const labels = items.map((i) => i.label);
        expect(labels).toContain("a");
        expect(labels).toContain("b");
        expect(labels).toContain("x");
        expect(labels).toContain("string.join");
    });

    it("includes DSL keywords when no dot prefix", () => {
        const items = computeCompletions(doc(), schemas);
        const labels = items.map((i) => i.label);
        expect(labels).toContain("const");
        expect(labels).toContain("if");
        expect(labels).toContain("return");
        expect(labels).toContain("true");
    });

    it("filters by namespace prefix when cursor is after a dot", () => {
        // Build a doc where the cursor is after "string." (col 12 on line 2)
        // line 2: "    return string.join([x], ","  — character 18 is after the dot
        const d = doc();
        // Position: line 2 "    return string.join..."  character 18 is after "string."
        const pos = { line: 2, character: 18 };
        const items = computeCompletions(d, schemas, pos);
        const labels = items.map((i) => i.label);
        // Should include string.* tasks with the "string." prefix stripped
        expect(labels.every((l) => !l.startsWith("shell."))).toBe(true);
        // Keywords should not appear
        expect(labels).not.toContain("const");
        // At least one string task (e.g. "join")
        expect(labels.some((l) => l === "join" || l.startsWith("string"))).toBe(
            true,
        );
    });

    it("includes no keywords when completing after a dot", () => {
        const d = doc();
        const pos = { line: 2, character: 18 }; // after "string."
        const items = computeCompletions(d, schemas, pos);
        const kws = ["const", "if", "else", "return", "true", "false"];
        for (const kw of kws) {
            expect(items.map((i) => i.label)).not.toContain(kw);
        }
    });

    it("returns no completions when the prefix matches no task namespace", () => {
        const src = `workflow w(): string {\n    return unknown.call();\n}`;
        const d = doc(src);
        const col = src.split("\n")[1]!.indexOf(".") + 1;
        const items = computeCompletions(d, schemas, {
            line: 1,
            character: col,
        });
        expect(items.length).toBe(0);
    });

    it("includes all task names when pos is undefined", () => {
        const items = computeCompletions(doc(), schemas);
        const labels = items.map((i) => i.label);
        expect(labels).toContain("shell.exec");
        expect(labels).toContain("string.join");
        expect(labels).toContain("list.length");
    });

    it("deduplicates symbol names that appear in multiple scopes", () => {
        const src = `workflow w(x: string): string {\n    if (true) {\n        const x = "inner";\n        return x;\n    }\n    return x;\n}`;
        const items = computeCompletions(doc(src), schemas);
        expect(items.filter((i) => i.label === "x").length).toBe(1);
    });
});

describe("semantic tokens", () => {
    it("emits tokens for params, consts, and task calls", () => {
        const tokens = computeSemanticTokens(doc());
        // data is delta-encoded: 5 numbers per token.
        expect(tokens.data.length % 5).toBe(0);
        expect(tokens.data.length).toBeGreaterThan(0);
        // We expect at least one parameter (type 0), one variable (type 1),
        // and one function (type 2) token in there.
        const tokenTypes = new Set<number>();
        for (let i = 3; i < tokens.data.length; i += 5) {
            tokenTypes.add(tokens.data[i]!);
        }
        expect(tokenTypes.has(0)).toBe(true);
        expect(tokenTypes.has(1)).toBe(true);
        expect(tokenTypes.has(2)).toBe(true);
    });

    it("emits property tokens for resolved property accesses", () => {
        const src = [
            "workflow w(s: string): string {",
            "    const r = shell.exec(s);",
            "    return r.stdout;",
            "}",
        ].join("\n");
        const tokens = computeSemanticTokens(doc(src));
        expect(tokens.data.length % 5).toBe(0);
        const tokenTypes = new Set<number>();
        for (let i = 3; i < tokens.data.length; i += 5) {
            tokenTypes.add(tokens.data[i]!);
        }
        // type 3 = property
        expect(tokenTypes.has(3)).toBe(true);
    });

    it("delta-decoded positions are non-decreasing in (line, col)", () => {
        const src = `workflow w(a: string, b: number): string {\n    const x = a;\n    return string.join([x, b], ",");\n}`;
        const tokens = computeSemanticTokens(doc(src));
        const data = tokens.data;
        let prevLine = 0;
        let prevChar = 0;
        for (let i = 0; i < data.length; i += 5) {
            const dLine = data[i]!;
            const dChar = data[i + 1]!;
            const line = prevLine + dLine;
            const char = dLine === 0 ? prevChar + dChar : dChar;
            if (line === prevLine) {
                expect(char).toBeGreaterThanOrEqual(prevChar);
            } else {
                expect(line).toBeGreaterThan(prevLine);
            }
            prevLine = line;
            prevChar = char;
        }
    });
});
