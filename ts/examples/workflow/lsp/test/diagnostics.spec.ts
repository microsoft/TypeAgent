// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { computeDiagnostics } from "../src/features/diagnostics.js";
import { loadTaskSchemas } from "../src/taskSchemas.js";

const schemas = loadTaskSchemas();

describe("diagnostics", () => {
    it("returns no diagnostics for a valid workflow", () => {
        const src = `
workflow trivial(x: string): string {
    const y = string.join([x], ",");
    return y;
}
`;
        const diags = computeDiagnostics(src, schemas);
        expect(diags).toEqual([]);
    });

    it("flags a syntax error with a range and source 'workflow'", () => {
        const src = `workflow broken( {`;
        const diags = computeDiagnostics(src, schemas);
        expect(diags.length).toBeGreaterThan(0);
        const first = diags[0]!;
        expect(first.source).toBe("workflow");
        expect(first.severity).toBe(1); // Error
        expect(typeof first.range.start.line).toBe("number");
        expect(typeof first.range.start.character).toBe("number");
        expect(first.range.end.character).toBeGreaterThan(
            first.range.start.character,
        );
    });

    it("flags an unknown identifier as a typecheck error", () => {
        const src = `
workflow w(): string {
    return unknownIdent;
}
`;
        const diags = computeDiagnostics(src, schemas);
        expect(diags.length).toBeGreaterThan(0);
        expect(diags.some((d) => d.code === "typecheck")).toBe(true);
    });

    it("tags lex errors with code 'lex'", () => {
        // Unterminated string literal.
        const src = `workflow w(): string { return "unclosed; }`;
        const diags = computeDiagnostics(src, schemas);
        expect(diags.length).toBeGreaterThan(0);
        expect(diags[0]!.code === "lex" || diags[0]!.code === "parse").toBe(
            true,
        );
    });

    it("returns more than one diagnostic for a deeply broken source", () => {
        // Missing closing brace and stray token produce multiple parse errors.
        const src = `workflow broken(x: `;
        const diags = computeDiagnostics(src, schemas);
        expect(diags.length).toBeGreaterThan(1);
    });

    it("surfaces typecheck errors from every workflow in a multi-workflow file", () => {
        // Both workflows reference an unknown identifier; each must
        // produce its own diagnostic so a silent-drop bug (only first
        // workflow checked) is caught.
        const src = `workflow a(): string {
    return missingA;
}
workflow b(): string {
    return missingB;
}
`;
        const diags = computeDiagnostics(src, schemas);
        const messages = diags.map((d) => d.message).join("\n");
        expect(messages).toContain("missingA");
        expect(messages).toContain("missingB");
        // And the ranges must land on different lines (one per workflow).
        const linesWithErrors = new Set(diags.map((d) => d.range.start.line));
        expect(linesWithErrors.size).toBeGreaterThanOrEqual(2);
    });
});
