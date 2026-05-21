// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver/node.js";
import { previewGraph } from "../src/features/previewGraph.js";

class FakeDocuments {
    private map = new Map<string, TextDocument>();
    add(uri: string, text: string): void {
        this.map.set(uri, TextDocument.create(uri, "workflow", 1, text));
    }
    get(uri: string): TextDocument | undefined {
        return this.map.get(uri);
    }
}

describe("previewGraph", () => {
    it("returns a graph for a well-formed workflow", () => {
        const docs = new FakeDocuments();
        docs.add(
            "file:///g.wf",
            `workflow greet(name: string): string {\n    const msg = string.concat(["Hello, ", name]);\n    return msg;\n}\n`,
        );
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///g.wf",
        });
        expect(r.errors).toEqual([]);
        expect(r.graph).toBeDefined();
        expect(r.graph!.workflowName).toBe("greet");
        expect(r.graph!.params.map((p) => p.name)).toEqual(["name"]);
        expect(r.graph!.nodes.length).toBeGreaterThan(0);
    });

    it("surfaces parse errors (graph may still be partial on recovery)", () => {
        const docs = new FakeDocuments();
        // Malformed parameter list — parser recovers but reports errors.
        docs.add("file:///g.wf", `workflow broken( {`);
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///g.wf",
        });
        expect(r.errors.length).toBeGreaterThan(0);
        for (const e of r.errors) {
            expect(typeof e.message).toBe("string");
            expect(typeof e.line).toBe("number");
            expect(["lex", "parse"]).toContain(e.phase);
        }
    });

    it("returns no graph when lex fails outright", () => {
        const docs = new FakeDocuments();
        // Unterminated string literal — causes a lex error before parse.
        docs.add(
            "file:///g.wf",
            `workflow w(): string {\n    const x = "unterminated;\n    return x;\n}\n`,
        );
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///g.wf",
        });
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.errors.every((e) => e.phase === "lex")).toBe(true);
        expect(r.graph).toBeUndefined();
    });

    it("reports an unknown-document error for missing URIs", () => {
        const docs = new FakeDocuments();
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///missing.wf",
        });
        expect(r.graph).toBeUndefined();
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]!.message).toContain("unknown document");
    });

    it("still returns a graph when there are typecheck errors", () => {
        // unknownIdent is not declared anywhere, which is a typecheck
        // error in compile(), but the AST still parses cleanly and
        // extractGraph() should produce a usable graph.
        const docs = new FakeDocuments();
        docs.add(
            "file:///g.wf",
            `workflow w(): string {\n    return unknownIdent;\n}\n`,
        );
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///g.wf",
        });
        expect(r.graph).toBeDefined();
        expect(r.errors).toEqual([]);
    });

    it("returns a params-only graph for a workflow with an empty body", () => {
        const docs = new FakeDocuments();
        docs.add(
            "file:///g.wf",
            `workflow noop(name: string): string {\n    return name;\n}\n`,
        );
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///g.wf",
        });
        expect(r.errors).toEqual([]);
        expect(r.graph!.params).toHaveLength(1);
        expect(r.graph!.params[0]!.name).toBe("name");
        // The return statement itself produces a node, but no task /
        // workflowCall / template nodes should appear in a body that
        // only references a parameter.
        const heavy = r.graph!.nodes.filter((n) =>
            ["task", "workflowCall", "template"].includes(n.kind),
        );
        expect(heavy).toEqual([]);
    });

    it("populates groups[] for control-flow constructs", () => {
        const docs = new FakeDocuments();
        docs.add(
            "file:///g.wf",
            `workflow w(x: string): string {\n    if (string.equals([x, "a"])) {\n        return "A";\n    } else {\n        return "B";\n    }\n}\n`,
        );
        const r = previewGraph(docs as unknown as TextDocuments<TextDocument>, {
            uri: "file:///g.wf",
        });
        expect(r.graph).toBeDefined();
        // An if/else generates at least one "if-then" group and one
        // "if-else" group.
        const kinds = r.graph!.groups.map((g) => g.kind);
        expect(kinds).toEqual(expect.arrayContaining(["if-then", "if-else"]));
    });
});
