// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lex, Parser } from "workflow-dsl";
import { buildSymbolTable } from "../src/symbolResolver.js";

function parse(src: string) {
    const { tokens, comments } = lex(src);
    const { workflows } = new Parser(tokens, comments).parse();
    const ast = workflows[0];
    if (!ast) throw new Error("parse failed");
    return ast;
}

describe("symbol resolver", () => {
    it("records params, consts, and references", () => {
        const ast = parse(`
workflow w(a: string, b: number): string {
    const x = a;
    return x;
}
`);
        const table = buildSymbolTable(ast);
        const defNames = table.defs.map((d) => d.name).sort();
        expect(defNames).toEqual(["a", "b", "x"]);

        // 'a' is referenced in 'const x = a;', 'x' is referenced in 'return x;'
        const refNames = table.refs.map((r) => r.name);
        expect(refNames).toContain("a");
        expect(refNames).toContain("x");

        const refA = table.refs.find((r) => r.name === "a")!;
        expect(refA.def?.kind).toBe("param");
    });

    it("records task calls in taskRefs", () => {
        const ast = parse(`
workflow w(s: string): string {
    return string.join([s], ",");
}
`);
        const table = buildSymbolTable(ast);
        const taskNames = table.taskRefs.map((t) => t.name);
        expect(taskNames).toContain("string.join");
    });

    it("introduces lambda params in inner scope", () => {
        const ast = parse(`
workflow w(xs: string[]): string[] {
    return map(xs, (x) => {
        return x;
    });
}
`);
        const table = buildSymbolTable(ast);
        const lambda = table.defs.find((d) => d.name === "x");
        expect(lambda).toBeDefined();
        expect(lambda!.kind).toBe("lambdaParam");

        const refX = table.refs.find((r) => r.name === "x");
        expect(refX?.def).toBe(lambda);
    });

    it("lambda param definition location points to the param token, not the map call", () => {
        // 'repo' appears as the lambda param on line 2 (0-based), col 19 in:
        // workflow w(repos: string[]): string[] {
        //     return map(repos, (repo) => { return repo; });
        // }
        const src = [
            "workflow w(repos: string[]): string[] {",
            "    return map(repos, (repo) => { return repo; });",
            "}",
        ].join("\n");
        const ast = parse(src);
        const table = buildSymbolTable(ast);
        const paramDef = table.defs.find((d) => d.name === "repo");
        expect(paramDef).toBeDefined();
        expect(paramDef!.kind).toBe("lambdaParam");
        // The definition location should be the 'repo' token itself, not the
        // start of the map() call.
        // Line is 1-based; 'repo' is on the second source line.
        expect(paramDef!.loc.line).toBe(2);
        // Col is 0-based: '    return map(repos, (' = 23 chars, then 'repo' at 24.
        expect(paramDef!.loc.col).toBe(24);
    });

    it("does not resolve unknown names", () => {
        const ast = parse(`
workflow w(): string {
    return unknownName;
}
`);
        const table = buildSymbolTable(ast);
        const ref = table.refs.find((r) => r.name === "unknownName");
        expect(ref).toBeDefined();
        expect(ref!.def).toBeUndefined();
    });
});
