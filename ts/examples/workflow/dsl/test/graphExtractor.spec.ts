// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extractGraph, GraphModel } from "../src/graphExtractor.js";
import { Parser } from "../src/parser.js";
import { lex } from "../src/lexer.js";
import { WorkflowDecl } from "../src/ast.js";

function parseWf(source: string): WorkflowDecl {
    const { tokens, errors: lexErrors } = lex(source);
    if (lexErrors.length > 0) {
        throw new Error(
            `Lex errors: ${lexErrors.map((e: { message: string }) => e.message).join(", ")}`,
        );
    }
    const parser = new Parser(tokens);
    const ast = parser.parse();
    if (ast.errors.length > 0) {
        throw new Error(
            `Parse errors: ${ast.errors.map((e: { message: string }) => e.message).join(", ")}`,
        );
    }
    if (ast.workflows.length === 0) {
        throw new Error("No workflow found");
    }
    return ast.workflows[0];
}

function extract(source: string): GraphModel {
    return extractGraph(parseWf(source));
}

describe("Graph extractor", () => {
    // ---- Basic structure ----

    test("extracts workflow name and params", () => {
        const g = extract(
            `workflow greet(name: string): string { return name; }`,
        );
        expect(g.workflowName).toBe("greet");
        expect(g.params).toHaveLength(1);
        expect(g.params[0].name).toBe("name");
        expect(g.params[0].type).toBe("string");
    });

    test("return node with edge from param", () => {
        const g = extract(`workflow test(x: string): string { return x; }`);
        expect(g.nodes).toHaveLength(1);
        expect(g.nodes[0].kind).toBe("return");
        expect(g.edges).toHaveLength(1);
        expect(g.edges[0].from).toBe("param_x");
        expect(g.edges[0].to).toBe(g.nodes[0].id);
    });

    // ---- Task calls ----

    test("task call creates task node with edges", () => {
        const g = extract(`
            workflow test(url: string): unknown {
                const result = web.fetch(url);
                return result;
            }
        `);
        const taskNode = g.nodes.find((n) => n.kind === "task");
        expect(taskNode).toBeDefined();
        expect(taskNode!.taskType).toBe("web.fetch");
        expect(taskNode!.bindName).toBe("result");
        // Edge from param_url to task node
        const edge = g.edges.find((e) => e.from === "param_url");
        expect(edge).toBeDefined();
    });

    // ---- Constants ----

    test("literal const creates constant node", () => {
        const g = extract(`
            workflow test(): string {
                const greeting = "hello";
                return greeting;
            }
        `);
        const constNode = g.nodes.find((n) => n.kind === "constant");
        expect(constNode).toBeDefined();
        expect(constNode!.label).toContain("greeting");
    });

    // ---- Template literals ----

    test("template literal creates template node", () => {
        const g = extract(`
            workflow test(name: string): unknown {
                const msg = \`Hello \${name}!\`;
                return msg;
            }
        `);
        const tmplNode = g.nodes.find((n) => n.kind === "template");
        expect(tmplNode).toBeDefined();
        expect(tmplNode!.taskType).toBe("text.template");
    });

    // ---- If/else ----

    test("if/else creates groups", () => {
        const g = extract(`
            workflow test(x: boolean): unknown {
                if (x) {
                    const a = web.fetch("https://a.com");
                } else {
                    const b = web.fetch("https://b.com");
                }
                return "done";
            }
        `);
        const thenGroup = g.groups.find((gr) => gr.kind === "if-then");
        expect(thenGroup).toBeDefined();
        expect(thenGroup!.label).toContain("if");
        const elseGroup = g.groups.find((gr) => gr.kind === "if-else");
        expect(elseGroup).toBeDefined();
    });

    // ---- Switch ----

    test("switch creates groups for cases", () => {
        const g = extract(`
            workflow test(x: string): unknown {
                switch (x) {
                    case "a":
                        const r1 = web.fetch("https://a.com");
                    case "b":
                        const r2 = web.fetch("https://b.com");
                    default:
                        const r3 = web.fetch("https://fallback.com");
                }
                return "done";
            }
        `);
        const switchGroup = g.groups.find((gr) => gr.kind === "switch");
        expect(switchGroup).toBeDefined();
        const caseGroups = g.groups.filter((gr) => gr.kind === "switch-case");
        expect(caseGroups).toHaveLength(2);
        const defaultGroup = g.groups.find(
            (gr) => gr.kind === "switch-default",
        );
        expect(defaultGroup).toBeDefined();
    });

    // ---- Throw ----

    test("throw creates error node", () => {
        const g = extract(`
            workflow test(): unknown {
                throw "something went wrong";
                return "never";
            }
        `);
        const errorNode = g.nodes.find((n) => n.kind === "error");
        expect(errorNode).toBeDefined();
        expect(errorNode!.label).toContain("throw");
    });

    // ---- Binary operator ----

    test("binary operator creates operator node", () => {
        const g = extract(`
            workflow test(a: integer, b: integer): unknown {
                const sum = a + b;
                return sum;
            }
        `);
        const opNode = g.nodes.find((n) => n.kind === "operator");
        expect(opNode).toBeDefined();
        expect(opNode!.label).toBe("+");
        // Should have edges from both params
        const edgesToOp = g.edges.filter((e) => e.to === opNode!.id);
        expect(edgesToOp).toHaveLength(2);
    });

    // ---- Attempts ----

    test("attempts creates group", () => {
        const g = extract(`
            workflow test(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const attemptsGroup = g.groups.find((gr) => gr.kind === "attempts");
        expect(attemptsGroup).toBeDefined();
        expect(attemptsGroup!.label).toContain("attempts");
        // Body should contain a task node
        expect(attemptsGroup!.children.length).toBeGreaterThan(0);
    });

    // ---- Map ----

    test("map creates group with edge from collection", () => {
        const g = extract(`
            workflow test(urls: string[]): unknown {
                return map(urls, (url) => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const mapGroup = g.groups.find((gr) => gr.kind === "map");
        expect(mapGroup).toBeDefined();
        expect(mapGroup!.label).toContain("map");
        // Edge from urls param to the group
        const edge = g.edges.find((e) => e.from === "param_urls");
        expect(edge).toBeDefined();
    });

    // ---- Filter ----

    test("filter creates group", () => {
        const g = extract(`
            workflow test(items: string[]): unknown {
                return filter(items, (item) => {
                    return item === "keep";
                });
            }
        `);
        const filterGroup = g.groups.find((gr) => gr.kind === "filter");
        expect(filterGroup).toBeDefined();
    });

    // ---- Parallel ----

    test("parallel creates group", () => {
        const g = extract(`
            workflow test(): unknown {
                return parallel(
                    () => { return "a"; },
                    () => { return "b"; }
                );
            }
        `);
        const parallelGroup = g.groups.find((gr) => gr.kind === "parallel");
        expect(parallelGroup).toBeDefined();
        expect(parallelGroup!.label).toContain("2 branches");
    });

    // ---- ParallelMap ----

    test("parallelMap creates group", () => {
        const g = extract(`
            workflow test(urls: string[]): unknown {
                return parallelMap(urls, (url) => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const pmGroup = g.groups.find((gr) => gr.kind === "parallelMap");
        expect(pmGroup).toBeDefined();
        expect(pmGroup!.label).toContain("parallelMap");
    });

    // ---- Destructuring ----

    test("destructuring binds names to source", () => {
        const g = extract(`
            workflow test(): unknown {
                const results = parallel(
                    () => { return "a"; },
                    () => { return "b"; }
                );
                const [a, b] = results;
                return a;
            }
        `);
        // The outer return node (not inside the parallel group)
        const returnNode = g.nodes.find(
            (n) => n.kind === "return" && !n.groupId,
        );
        expect(returnNode).toBeDefined();
        // Should have edge from the parallel group to outer return
        const edgeToReturn = g.edges.find((e) => e.to === returnNode!.id);
        expect(edgeToReturn).toBeDefined();
    });

    // ---- Workflow call ----

    test("workflow call creates workflowCall node", () => {
        const g = extract(`
            workflow test(url: string): unknown {
                const result = helper(url);
                return result;
            }
        `);
        const callNode = g.nodes.find((n) => n.kind === "workflowCall");
        expect(callNode).toBeDefined();
        expect(callNode!.taskType).toBe("helper");
    });

    // ---- Dotted name alias (regression: was silently dropped) ----

    test("const assigned from a dotted name reference propagates binding", () => {
        const g = extract(`
            workflow test(url: string): unknown {
                const fetched = web.fetch(url);
                const alias = fetched.result;
                const out = text.summarize(alias);
                return out;
            }
        `);
        // fetched -> task node; out -> task node; alias must not break the chain
        const fetchNode = g.nodes.find((n) => n.taskType === "web.fetch");
        const summarizeNode = g.nodes.find(
            (n) => n.taskType === "text.summarize",
        );
        expect(fetchNode).toBeDefined();
        expect(summarizeNode).toBeDefined();
        // There should be an edge from the fetch node through alias to summarize
        const edge = g.edges.find(
            (e) => e.from === fetchNode!.id && e.to === summarizeNode!.id,
        );
        expect(edge).toBeDefined();
    });

    // ---- Nested groups ----

    test("nested built-ins create nested groups", () => {
        const g = extract(`
            workflow test(urls: string[]): unknown {
                return map(urls, (url) => {
                    return attempts(3, () => {
                        const result = web.fetch(url);
                        return result;
                    });
                });
            }
        `);
        const mapGroup = g.groups.find((gr) => gr.kind === "map");
        const attemptsGroup = g.groups.find((gr) => gr.kind === "attempts");
        expect(mapGroup).toBeDefined();
        expect(attemptsGroup).toBeDefined();
        expect(attemptsGroup!.parentId).toBe(mapGroup!.id);
    });
});
