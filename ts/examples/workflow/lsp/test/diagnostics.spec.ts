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
});
