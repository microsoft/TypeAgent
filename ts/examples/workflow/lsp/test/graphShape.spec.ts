// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Snapshot test for extractGraph(). Pins the shape of the GraphModel
 * returned for representative workflow sources so upstream DSL changes
 * that alter the graph structure surface as deliberate diffs.
 *
 * Snapshots are stored beside this file in __snapshots__/. Update them
 * intentionally with `jest --updateSnapshot` when the DSL graph model
 * evolves.
 */

import { lex, Parser, extractGraph } from "workflow-dsl";

function parseAndExtract(src: string) {
    const { tokens, comments } = lex(src);
    const { workflows } = new Parser(tokens, comments).parse();
    const ast = workflows[0];
    if (!ast) throw new Error("parse failed");
    return extractGraph(ast);
}

describe("extractGraph snapshots", () => {
    it("simple linear workflow", () => {
        const g = parseAndExtract(`
workflow greet(name: string): string {
    const msg = string.concat(["Hello, ", name]);
    return msg;
}
`);
        expect(g).toMatchSnapshot();
    });

    it("conditional workflow", () => {
        const g = parseAndExtract(`
workflow check(x: number): string {
    if (x) {
        return "positive";
    } else {
        return "zero";
    }
}
`);
        expect(g).toMatchSnapshot();
    });

    it("map workflow", () => {
        const g = parseAndExtract(`
workflow processAll(items: string[]): string[] {
    return map(items, (item) => {
        return item;
    });
}
`);
        expect(g).toMatchSnapshot();
    });

    it("parallel workflow", () => {
        const g = parseAndExtract(`
workflow dual(a: string, b: string): string {
    parallel {
        branch { const r1 = string.concat([a]); }
        branch { const r2 = string.concat([b]); }
    }
    return a;
}
`);
        expect(g).toMatchSnapshot();
    });
});
