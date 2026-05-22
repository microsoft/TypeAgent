// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar / lexer snapshot tests.
 *
 * We don't use vscode-tmgrammar-test (requires a display server) — instead
 * we use the workflow-dsl lexer as the ground truth for token coverage.
 * Snapshot the token-kind array for a canonical "full-feature" program
 * so that grammar/lexer regressions are caught.
 */

import { lex } from "workflow-dsl";

const FULL_FEATURE_SRC = `
workflow fullFeature(name: string, count: number): string {
    const greeting = string.concat(["Hello, ", name, "!"]);
    const doubled = count * 2;
    const msg = if (count > 0) {
        greeting
    } else {
        "none"
    };
    const result = switch (msg) {
        case "none": "empty"
        default: msg
    };
    return result;
}
`.trim();

describe("lexer token coverage", () => {
    it("produces no lex errors on full-feature program", () => {
        const { errors } = lex(FULL_FEATURE_SRC);
        expect(errors).toHaveLength(0);
    });

    it("includes all keyword token kinds", () => {
        const { tokens } = lex(FULL_FEATURE_SRC);
        const kinds = new Set(tokens.map((t) => t.kind));
        expect(kinds).toContain("workflow");
        expect(kinds).toContain("const");
        expect(kinds).toContain("if");
        expect(kinds).toContain("else");
        expect(kinds).toContain("switch");
        expect(kinds).toContain("case");
        expect(kinds).toContain("default");
        expect(kinds).toContain("return");
    });

    it("includes literal token kinds", () => {
        const src = `workflow w(): string {
            const s = "hello";
            const n = 42;
            const b = true;
            const nil = null;
            return s;
        }`;
        const { tokens } = lex(src);
        const kinds = new Set(tokens.map((t) => t.kind));
        expect(kinds).toContain("StringLiteral");
        expect(kinds).toContain("NumberLiteral");
        expect(kinds).toContain("BooleanLiteral");
        expect(kinds).toContain("NullLiteral");
    });

    it("includes identifier tokens", () => {
        const { tokens } = lex(FULL_FEATURE_SRC);
        const kinds = new Set(tokens.map((t) => t.kind));
        expect(kinds).toContain("Identifier");
    });

    it("includes template literal tokens", () => {
        const src = "workflow w(x: string): string { return `hello ${x}!`; }";
        const { tokens, errors } = lex(src);
        expect(errors).toHaveLength(0);
        const kinds = new Set(tokens.map((t) => t.kind));
        // Template head/tail for `hello ${x}!`
        expect(kinds).toContain("TemplateHead");
        expect(kinds).toContain("TemplateTail");
    });

    it("includes comment tokens", () => {
        const src = `// leading comment
workflow w(): string {
    /* block */ const x = "v"; // inline
    return x;
}`;
        const { comments } = lex(src);
        expect(comments.length).toBeGreaterThanOrEqual(3);
    });

    it("snapshots token kind sequence for full-feature program", () => {
        const { tokens } = lex(FULL_FEATURE_SRC);
        const kindSeq = tokens.map((t) => t.kind);
        expect(kindSeq).toMatchSnapshot();
    });
});
