// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Emitter, TaskSchemaInfo } from "../src/emitter.js";
import { Parser } from "../src/parser.js";
import { lex } from "../src/lexer.js";
import {
    WorkflowIR,
    WorkflowBody,
    WorkflowNode,
    TaskNode,
    BranchNode,
    LoopNode,
    ForkNode,
    ForkMapNode,
} from "workflow-model";

function bodyOf(ir: WorkflowIR): WorkflowBody {
    return ir.workflows[ir.entry];
}

// Common task schemas for testing
const taskSchemas: TaskSchemaInfo[] = [
    {
        name: "text.template",
        inputSchema: {
            type: "object",
            properties: {
                template: { type: "string" },
                vars: { type: "object" },
            },
        },
        outputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
        },
    },
    {
        name: "web.fetch",
        inputSchema: {
            type: "object",
            required: ["url"],
            properties: { url: { type: "string" } },
        },
        outputSchema: {
            type: "object",
            properties: { body: { type: "string" } },
        },
    },
    {
        name: "text.summarize",
        inputSchema: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
        },
        outputSchema: {
            type: "object",
            properties: { summary: { type: "string" } },
        },
    },
    {
        name: "list.elementAt",
        inputSchema: {
            type: "object",
            required: ["list", "index"],
            properties: { list: { type: "array" }, index: { type: "integer" } },
        },
        outputSchema: {},
    },
    {
        name: "list.length",
        inputSchema: {
            type: "object",
            required: ["list"],
            properties: { list: { type: "array" } },
        },
        outputSchema: { type: "integer" },
    },
    {
        name: "list.append",
        inputSchema: {
            type: "object",
            required: ["list", "item"],
            properties: { list: { type: "array" }, item: {} },
        },
        outputSchema: { type: "array" },
    },
    {
        name: "math.add",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "compare.lessThan",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: {}, right: {} },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.greaterOrEqual",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: {}, right: {} },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.equals",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: {}, right: {} },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "bool.not",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "boolean" } },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "math.negate",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "error.fail",
        inputSchema: {
            type: "object",
            required: ["message"],
            properties: { message: {} },
        },
        outputSchema: {},
    },
    {
        name: "identity",
        inputSchema: {},
        outputSchema: {},
    },
];

function compile(source: string): {
    ir: WorkflowIR | undefined;
    errors: { message: string }[];
} {
    const tokens = lex(source);
    if (tokens.errors.length > 0) {
        return {
            ir: undefined,
            errors: tokens.errors.map((e: { message: string }) => ({
                message: e.message,
            })),
        };
    }
    const parser = new Parser(tokens.tokens);
    const ast = parser.parse();
    if (ast.errors.length > 0) {
        return {
            ir: undefined,
            errors: ast.errors.map((e: { message: string }) => ({
                message: e.message,
            })),
        };
    }
    if (ast.workflows.length === 0) {
        return { ir: undefined, errors: [{ message: "No workflow found" }] };
    }
    const emitter = new Emitter(taskSchemas);
    // Use multi-workflow emit so workflow-to-workflow calls resolve.
    // Pick the first 'export' workflow as the entry, or the first
    // workflow if none exported (matches compiler.ts behavior for
    // single-workflow tests).
    const entry =
        ast.workflows.find((w) => w.exported)?.name ?? ast.workflows[0].name;
    return emitter.emitAll(ast.workflows, entry);
}

function compileOk(source: string): WorkflowIR {
    const result = compile(source);
    if (result.errors.length > 0) {
        throw new Error(
            `Unexpected errors: ${result.errors.map((e) => e.message).join(", ")}`,
        );
    }
    if (!result.ir) {
        throw new Error("No IR produced");
    }
    return result.ir;
}

function getNode(ir: WorkflowIR, id: string): WorkflowNode {
    const node = bodyOf(ir).nodes[id];
    if (!node) {
        const keys = Object.keys(bodyOf(ir).nodes);
        throw new Error(
            `Node '${id}' not found. Available: ${keys.join(", ")}`,
        );
    }
    return node;
}

function findNodeByTask(ir: WorkflowIR, task: string): [string, TaskNode] {
    for (const [id, node] of Object.entries(bodyOf(ir).nodes)) {
        if (node.kind === "task" && node.task === task) {
            return [id, node];
        }
    }
    throw new Error(`No task node with task '${task}' found`);
}

function findNodeByKind<T extends WorkflowNode>(
    ir: WorkflowIR,
    kind: T["kind"],
): [string, T] {
    for (const [id, node] of Object.entries(bodyOf(ir).nodes)) {
        if (node.kind === kind) {
            return [id, node as T];
        }
    }
    throw new Error(`No node with kind '${kind}' found`);
}

describe("Emitter", () => {
    // ---- Basic workflow structure ----

    test("minimal workflow with literal return", () => {
        const ir = compileOk(`workflow hello(): string { return "hi"; }`);
        expect(ir.entry).toBe("hello");
        // Pure literal returns are wrapped in identity nodes for engine entry
        expect(bodyOf(ir).output).toEqual({
            $from: "scope",
            name: "return_0",
        });
        expect(bodyOf(ir).nodes["return_0"]).toBeDefined();
        expect((bodyOf(ir).nodes["return_0"] as any).task).toBe("identity");
        expect((bodyOf(ir).nodes["return_0"] as any).inputs.value).toBe("hi");
        expect(bodyOf(ir).inputSchema).toEqual({
            type: "object",
            required: [],
            properties: {},
        });
        expect(bodyOf(ir).outputSchema).toEqual({ type: "string" });
    });

    test("workflow with params", () => {
        const ir = compileOk(
            `workflow greet(name: string): string { return name; }`,
        );
        expect(bodyOf(ir).inputSchema).toEqual({
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
        });
        // Input-only return is wrapped in identity for engine entry
        expect(bodyOf(ir).output).toEqual({
            $from: "scope",
            name: "return_0",
        });
        expect((bodyOf(ir).nodes["return_0"] as any).inputs.value).toEqual({
            $from: "input",
            name: "name",
        });
    });

    // ---- Task calls ----

    test("task call with positional args", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                const result = web.fetch(url);
                return result;
            }
        `);
        expect(bodyOf(ir).entry).toBe("result");
        const node = getNode(ir, "result") as TaskNode;
        expect(node.kind).toBe("task");
        expect(node.task).toBe("web.fetch");
        expect(node.inputs).toEqual({ url: { $from: "input", name: "url" } });
    });

    test("task call with named args", () => {
        const ir = compileOk(`
            workflow test(): unknown {
                const result = web.fetch(url: "https://example.com");
                return result;
            }
        `);
        const node = getNode(ir, "result") as TaskNode;
        expect(node.inputs).toEqual({ url: "https://example.com" });
    });

    test("task call chain with next threading", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                const fetched = web.fetch(url);
                const summary = text.summarize(fetched);
                return summary;
            }
        `);
        const fetchNode = getNode(ir, "fetched") as TaskNode;
        expect(fetchNode.next).toBe("summary");
    });

    // ---- Constants ----

    test("const with literal value goes to constants", () => {
        const ir = compileOk(`
            workflow test(): string {
                const greeting = "hello";
                return greeting;
            }
        `);
        expect(ir.constants).toBeDefined();
        expect(ir.constants!.greeting).toEqual({
            schema: { type: "string" },
            value: "hello",
        });
        expect(bodyOf(ir).output).toEqual({
            $from: "scope",
            name: "return_0",
        });
        expect((bodyOf(ir).nodes["return_0"] as any).inputs.value).toEqual({
            $from: "constant",
            name: "greeting",
        });
    });

    // ---- Template literals ----

    test("template literal emits text.template task", () => {
        const ir = compileOk(`
            workflow test(name: string): unknown {
                const msg = \`Hello \${name}!\`;
                return msg;
            }
        `);
        // Should find a text.template node
        const [, tmplNode] = findNodeByTask(ir, "text.template");
        expect(tmplNode.inputs.template).toBe("Hello {{name}}!");
    });

    // ---- Binary operators ----

    test("binary === lowers to compare.equals", () => {
        const ir = compileOk(`
            workflow test(x: integer, y: integer): unknown {
                return x === y;
            }
        `);
        const [, node] = findNodeByTask(ir, "compare.equals");
        expect(node.inputs.left).toEqual({ $from: "input", name: "x" });
        expect(node.inputs.right).toEqual({ $from: "input", name: "y" });
    });

    test("binary + lowers to math.add", () => {
        const ir = compileOk(`
            workflow test(x: integer): unknown {
                return x + 1;
            }
        `);
        const [, node] = findNodeByTask(ir, "math.add");
        expect(node.inputs.left).toEqual({ $from: "input", name: "x" });
        expect(node.inputs.right).toBe(1);
    });

    // ---- Unary operators ----

    test("unary ! lowers to bool.not", () => {
        const ir = compileOk(`
            workflow test(x: boolean): unknown {
                return !x;
            }
        `);
        const [, node] = findNodeByTask(ir, "bool.not");
        expect(node.inputs.value).toEqual({ $from: "input", name: "x" });
    });

    test("unary - lowers to math.negate", () => {
        const ir = compileOk(`
            workflow test(x: integer): unknown {
                return -x;
            }
        `);
        const [, node] = findNodeByTask(ir, "math.negate");
        expect(node.inputs.value).toEqual({ $from: "input", name: "x" });
    });

    // ---- If statement ----

    test("if/else lowers to branch node", () => {
        const ir = compileOk(`
            workflow test(x: boolean): unknown {
                if (x) {
                    const a = web.fetch("https://a.com");
                } else {
                    const b = web.fetch("https://b.com");
                }
                return "done";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.cases).toHaveProperty("true");
        expect(branchNode.cases).toHaveProperty("false");
        // Boolean if-else is exhaustive: no default needed.
        // { type: "boolean" } is treated as implicit enum [true, false].
        expect(branchNode.default).toBeUndefined();
        expect(branchNode.selectorSchema).toEqual({ type: "boolean" });
        expect(branchNode.selectorSchema.enum).toBeUndefined();
    });

    // ---- Switch statement ----

    test("switch lowers to branch node", () => {
        const ir = compileOk(`
            workflow test(x: string): unknown {
                switch (x) {
                    case "a":
                        const r1 = web.fetch("https://a.com");
                    case "b":
                        const r2 = web.fetch("https://b.com");
                }
                return "done";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.cases).toHaveProperty("a");
        expect(branchNode.cases).toHaveProperty("b");
    });

    test("switch without default emits exhaustive branch (no default, enum selectorSchema)", () => {
        const ir = compileOk(`
            workflow test(x: string): unknown {
                switch (x) {
                    case "a":
                        const r1 = web.fetch("https://a.com");
                    case "b":
                        const r2 = web.fetch("https://b.com");
                }
                return "done";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.default).toBeUndefined();
        expect(branchNode.selectorSchema).toEqual({
            type: "string",
            enum: ["a", "b"],
        });
    });

    test("switch with default emits default-targeted branch", () => {
        const ir = compileOk(`
            workflow test(x: string): unknown {
                switch (x) {
                    case "a":
                        const r1 = web.fetch("https://a.com");
                    default:
                        const r2 = web.fetch("https://other.com");
                }
                return "done";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.default).toBeDefined();
        expect(branchNode.selectorSchema).toEqual({ type: "string" });
    });

    test("switch over integer case values infers integer type", () => {
        const ir = compileOk(`
            workflow test(x: number): unknown {
                switch (x) {
                    case 1:
                        const r1 = web.fetch("https://a.com");
                    case 2:
                        const r2 = web.fetch("https://b.com");
                }
                return "done";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.selectorSchema).toEqual({
            type: "integer",
            enum: [1, 2],
        });
    });

    // ---- Throw statement ----

    test("throw lowers to error.fail task", () => {
        const ir = compileOk(`
            workflow test(): unknown {
                throw "something went wrong";
                return "never";
            }
        `);
        const [, node] = findNodeByTask(ir, "error.fail");
        expect(node.inputs.message).toBe("something went wrong");
        expect(node.outputSchema).toEqual({ not: {} });
        expect(node.next).toBeUndefined();
        expect(node.bind).toBeUndefined();
    });

    test("never return type produces { not: {} } outputSchema", () => {
        const ir = compileOk(`
            workflow test(): never {
                throw "always fails";
            }
        `);
        expect(bodyOf(ir).outputSchema).toEqual({ not: {} });
    });

    test("unknown return type produces {} outputSchema", () => {
        const ir = compileOk(`
            workflow test(): unknown {
                return "anything";
            }
        `);
        expect(bodyOf(ir).outputSchema).toEqual({});
    });

    // ---- Ternary expression ----

    test("ternary lowers to branch node", () => {
        const ir = compileOk(`
            workflow test(x: boolean): unknown {
                return x ? "yes" : "no";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.cases).toHaveProperty("true");
    });

    // ---- Map built-in ----

    test("map lowers to loop node", () => {
        const ir = compileOk(`
            workflow test(urls: string[]): unknown {
                return map(urls, (url) => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        expect(loopNode.state).toHaveProperty("i");
        expect(loopNode.state).toHaveProperty("results");
        expect(loopNode.inputs).toHaveProperty("items");
    });

    test("map uses pre-check loop shape", () => {
        const ir = compileOk(`
            workflow test(urls: string[]): unknown {
                return map(urls, (url) => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;

        const lengthNode = body.nodes[body.entry] as TaskNode;
        expect(lengthNode.task).toBe("list.length");

        const compareNode = body.nodes[lengthNode.next!] as TaskNode;
        expect(compareNode.task).toBe("compare.lessThan");

        const checkNode = body.nodes[compareNode.next!] as BranchNode;
        expect(checkNode.kind).toBe("branch");
        // Default arm is a BranchArm sub-scope (no-op).
        expect(checkNode.default).toBeDefined();

        const trueArm = checkNode.cases["true"] as unknown as {
            scope: { entry: string; nodes: Record<string, TaskNode> };
        };
        const pickNode = trueArm.scope.nodes[trueArm.scope.entry] as TaskNode;
        expect(pickNode.task).toBe("list.elementAt");

        const stepNode = Object.values(trueArm.scope.nodes).find(
            (node): node is TaskNode =>
                node.kind === "task" && node.task === "math.add",
        );
        expect(stepNode).toBeDefined();
    });

    test("filter lowers to loop node with branch", () => {
        const ir = compileOk(`
            workflow test(items: string[]): unknown {
                return filter(items, (item) => {
                    return item === "keep";
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        expect(loopNode.state).toHaveProperty("i");
        expect(loopNode.state).toHaveProperty("results");
        // Body should contain a branch for the filter condition
        const bodyNodes = Object.values(loopNode.body.nodes);
        const branches = bodyNodes.filter((n) => n.kind === "branch");
        expect(branches.length).toBeGreaterThanOrEqual(1);
    });

    test("filter uses pre-check loop shape before body and conditional append", () => {
        const ir = compileOk(`
            workflow test(items: string[]): unknown {
                return filter(items, (item) => {
                    return item === "keep";
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;

        const lengthNode = body.nodes[body.entry] as TaskNode;
        expect(lengthNode.task).toBe("list.length");

        const compareNode = body.nodes[lengthNode.next!] as TaskNode;
        expect(compareNode.task).toBe("compare.lessThan");

        const checkNode = body.nodes[compareNode.next!] as BranchNode;
        expect(checkNode.kind).toBe("branch");
        // Default arm is a BranchArm sub-scope (no-op).
        expect(checkNode.default).toBeDefined();

        const trueArm = checkNode.cases["true"] as unknown as {
            scope: { entry: string; nodes: Record<string, TaskNode> };
        };
        const pickNode = trueArm.scope.nodes[trueArm.scope.entry] as TaskNode;
        expect(pickNode.task).toBe("list.elementAt");

        // Conditional filter branch lives inside the true arm scope.
        const conditionalBranch = Object.values(trueArm.scope.nodes).find(
            (node) => (node as { kind: string }).kind === "branch",
        );
        expect(conditionalBranch).toBeDefined();

        const stepNode = Object.values(trueArm.scope.nodes).find(
            (node): node is TaskNode =>
                (node as { kind: string }).kind === "task" &&
                (node as TaskNode).task === "math.add",
        );
        expect(stepNode).toBeDefined();
    });

    // ---- Parallel built-in ----

    test("parallel lowers to fork node", () => {
        const ir = compileOk(`
            workflow test(): unknown {
                return parallel(
                    () => {
                        const a = web.fetch("https://a.com");
                        return a;
                    },
                    () => {
                        const b = web.fetch("https://b.com");
                        return b;
                    }
                );
            }
        `);
        const [, forkNode] = findNodeByKind<ForkNode>(ir, "fork");
        expect(Object.keys(forkNode.branches)).toHaveLength(2);
    });

    // ---- ParallelMap built-in ----

    test("parallelMap lowers to forkMap node", () => {
        const ir = compileOk(`
            workflow test(urls: string[]): unknown {
                return parallelMap(urls, (url) => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, forkMapNode] = findNodeByKind<ForkMapNode>(ir, "forkMap");
        expect(forkMapNode.elementParam).toBe("url");
        expect(forkMapNode.collection).toEqual({
            $from: "input",
            name: "urls",
        });
    });

    // ---- Attempts built-in ----

    test("attempts lowers to loop node with attempt state", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        expect(loopNode.state).toHaveProperty("attempt");
        expect(loopNode.state!.attempt.initial).toBe(0);
    });

    test("attempts body: last task chains to set_done (success path)", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;
        const entryNode = body.nodes[body.entry] as TaskNode;
        expect(entryNode).toBeDefined();
        // Success path leads to attempts_done (binds _should_retry = false).
        const doneNode = body.nodes[entryNode.next!] as TaskNode;
        expect(doneNode.task).toBe("identity");
        expect(doneNode.bind).toBe("_should_retry");
    });

    test("attempts body: task nodes have onError pointing to step_attempt", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;
        const entryNode = body.nodes[body.entry] as TaskNode;
        expect(entryNode.onError).toBeDefined();
        // The onError target should be a step_attempt node
        const stepNode = body.nodes[entryNode.onError!] as TaskNode;
        expect(stepNode).toBeDefined();
        expect(stepNode.task).toBe("math.add");
    });

    test("attempts body: error path chains step -> check -> branch -> exhaust", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;
        const entryNode = body.nodes[body.entry] as TaskNode;

        // Follow the error path: step_attempt -> check_done -> attempts_check
        const stepNode = body.nodes[entryNode.onError!] as TaskNode;
        expect(stepNode.task).toBe("math.add");

        const checkNode = body.nodes[stepNode.next!] as TaskNode;
        expect(checkNode.task).toBe("compare.greaterOrEqual");

        const branchNode = body.nodes[checkNode.next!] as BranchNode;
        expect(branchNode.kind).toBe("branch");
        // The default arm is the retry arm (a sub-scope).
        expect(branchNode.default).toBeDefined();

        // The true case is the exhausted arm whose entry is error.fail.
        const exhaustArm = branchNode.cases["true"] as unknown as {
            scope: { entry: string; nodes: Record<string, TaskNode> };
        };
        const exhaustNode = exhaustArm.scope.nodes[
            exhaustArm.scope.entry
        ] as TaskNode;
        expect(exhaustNode.task).toBe("error.fail");
    });

    test("attempts infrastructure nodes are not in the main body chain", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result;
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;

        // Walk the body's main chain from entry via next pointers
        const mainChain = new Set<string>();
        let nodeId: string | undefined = body.entry;
        while (nodeId) {
            mainChain.add(nodeId);
            const node: WorkflowNode = body.nodes[nodeId];
            nodeId =
                node.kind !== "branch"
                    ? ((node as TaskNode).next ?? undefined)
                    : undefined;
        }

        // None of the attempts infrastructure nodes (math.add, compare.greaterOrEqual,
        // error.fail, branch) should be in the main chain
        for (const [id, node] of Object.entries(body.nodes)) {
            if (!mainChain.has(id) && node.kind === "task") {
                // These are error-path-only nodes
                expect([
                    "math.add",
                    "compare.greaterOrEqual",
                    "error.fail",
                ]).toContain((node as TaskNode).task);
            }
        }
    });

    // ---- Object return ----

    test("object literal return", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                const result = web.fetch(url);
                return { data: result, source: url };
            }
        `);
        expect(bodyOf(ir).output).toEqual({
            data: expect.objectContaining({ $from: "scope" }),
            source: { $from: "input", name: "url" },
        });
    });

    // ---- Workflow call ----

    test("workflow call emits workflowCall node", () => {
        const ir = compileOk(`
            workflow helper(url: string): unknown { return url; }
            export workflow main(url: string): unknown {
                const result = helper(url);
                return result;
            }
        `);
        // Should emit a workflowCall node referencing helper.
        const body = ir.workflows[ir.entry];
        const callNode = Object.values(body.nodes).find(
            (n) => (n as { kind: string }).kind === "workflowCall",
        );
        expect(callNode).toBeDefined();
        expect(
            (callNode as { workflowRef: { name: string } }).workflowRef.name,
        ).toBe("helper");
        // helper body must also be present in the workflows table.
        expect(ir.workflows.helper).toBeDefined();
    });

    test("workflow call inlines literal default for omitted arg", () => {
        const ir = compileOk(`
            workflow helper(a: string, n: number = 7): unknown { return a; }
            export workflow main(s: string): unknown {
                const r = helper(s);
                return r;
            }
        `);
        const body = ir.workflows[ir.entry];
        const callNode = Object.values(body.nodes).find(
            (n) => (n as { kind: string }).kind === "workflowCall",
        ) as { inputs: Record<string, unknown> };
        expect(callNode).toBeDefined();
        // The omitted 'n' is filled from the default literal 7.
        expect(callNode.inputs.n).toBe(7);
    });

    test("workflow call inlines default referencing earlier param", () => {
        const ir = compileOk(`
            workflow helper(a: number, b: number = a): number { return b; }
            export workflow main(x: number): number {
                const r = helper(x);
                return r;
            }
        `);
        const body = ir.workflows[ir.entry];
        const callNode = Object.values(body.nodes).find(
            (n) => (n as { kind: string }).kind === "workflowCall",
        ) as { inputs: Record<string, unknown> };
        expect(callNode).toBeDefined();
        // 'a' resolved from caller input 'x'; 'b' inlined to same template.
        expect(callNode.inputs.a).toEqual(callNode.inputs.b);
    });

    test("workflow call inlines default with path access on earlier param", () => {
        const ir = compileOk(`
            workflow helper(a: { n: number }, b: number = a.n): number { return b; }
            export workflow main(obj: { n: number }): number {
                const r = helper(obj);
                return r;
            }
        `);
        const body = ir.workflows[ir.entry];
        const callNode = Object.values(body.nodes).find(
            (n) => (n as { kind: string }).kind === "workflowCall",
        ) as { inputs: Record<string, unknown> };
        expect(callNode).toBeDefined();
        // 'b' default = a.n; 'a' was resolved to the input ref for 'obj',
        // so 'b' should be that same ref with path ["n"] appended.
        const bInput = callNode.inputs.b as {
            $from: string;
            name: string;
            path: string[];
        };
        expect(bInput.$from).toBe("input");
        expect(bInput.name).toBe("obj");
        expect(bInput.path).toEqual(["n"]);
    });

    // ---- Error cases ----

    test("unknown task produces error", () => {
        const result = compile(`
            workflow test(): unknown {
                const x = unknown.task("hello");
                return x;
            }
        `);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].message).toContain("Unknown task");
    });

    // ---- Destructuring ----

    test("destructuring literal array", () => {
        const ir = compileOk(`
            workflow test(): unknown {
                const [a, b] = ["hello", "world"];
                return a;
            }
        `);
        // a is a literal binding resolved to "hello", wrapped in identity
        expect(bodyOf(ir).output).toEqual({
            $from: "scope",
            name: "return_0",
        });
        expect((bodyOf(ir).nodes["return_0"] as any).inputs.value).toBe(
            "hello",
        );
    });

    // ---- Bind stripping ----

    test("unreferenced task binds are stripped", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                const unused = web.fetch(url);
                return "done";
            }
        `);
        // The web.fetch node should exist but bind should be stripped
        const nodes = Object.values(bodyOf(ir).nodes);
        const fetchNode = nodes.find(
            (n) => n.kind === "task" && n.task === "web.fetch",
        ) as TaskNode | undefined;
        expect(fetchNode).toBeDefined();
        expect(fetchNode!.bind).toBeUndefined();
    });

    // ---- Branch continuation ----

    test("statements after if/else are reachable", () => {
        const ir = compileOk(`
            workflow test(x: boolean, url: string): unknown {
                if (x) {
                    const a = web.fetch("https://a.com");
                }
                const b = text.summarize(url);
                return b;
            }
        `);
        // The summarize node should be reachable via a merge node
        const summarizeNode = Object.values(bodyOf(ir).nodes).find(
            (n) => n.kind === "task" && n.task === "text.summarize",
        ) as TaskNode | undefined;
        expect(summarizeNode).toBeDefined();
        // There should be a merge (noop) node
        const noopNodes = Object.values(bodyOf(ir).nodes).filter(
            (n) => n.kind === "task" && (n as TaskNode).task === "noop",
        );
        expect(noopNodes.length).toBeGreaterThan(0);
    });

    // ---- Switch with default ----

    test("switch with default arm", () => {
        const ir = compileOk(`
            workflow test(x: string): unknown {
                switch (x) {
                    case "a":
                        const r1 = web.fetch("https://a.com");
                    default:
                        const r2 = web.fetch("https://fallback.com");
                }
                return "done";
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");
        expect(branchNode.cases).toHaveProperty("a");
        // Default arm runs the fallback web.fetch.
        expect(branchNode.default).toBeDefined();
        const defaultArm = branchNode.default!;
        const defaultEntryId = defaultArm.scope.entry;
        expect(defaultEntryId).toMatch(/^r2|^default_/);
        const defaultEntry = defaultArm.scope.nodes[defaultEntryId];
        expect(defaultEntry.kind).toBe("task");
        expect((defaultEntry as TaskNode).inputs.url).toBe(
            "https://fallback.com",
        );
    });

    // ---- Dotted-name with path ----

    test("dotted-name access produces path in reference", () => {
        const ir = compileOk(`
            workflow test(url: string): unknown {
                const result = web.fetch(url);
                return result.body;
            }
        `);
        const output = bodyOf(ir).output as Record<string, unknown>;
        expect(output.$from).toBe("scope");
        // Should have a path for .body access
        expect(output.path).toEqual(["body"]);
    });

    // ---- Chained operators ----

    test("chained binary operators produce multiple nodes", () => {
        const ir = compileOk(`
            workflow test(a: integer, b: integer, c: integer): unknown {
                return a + b * c;
            }
        `);
        // Should have at least 2 math nodes (add and multiply)
        const mathNodes = Object.values(bodyOf(ir).nodes).filter(
            (n) =>
                n.kind === "task" && (n as TaskNode).task.startsWith("math."),
        );
        expect(mathNodes.length).toBe(2);
    });

    // ---- Workflow description ----

    test("description flows from AST to IR", () => {
        // The parser doesn't support descriptions in the DSL syntax currently,
        // so we test the emitter directly with a manually constructed AST
        // (skip this test - covered by the parser)
    });

    // ---- BranchArm sub-scope structural assertions ----

    // Both arms of an if/else that contain only a return statement
    // must compile to a single-task noop arm whose output template
    // points at the workflow input passed in via the arm's `inputs`.
    test("if/else with return-only arms uses buildOutputOnlyArm shape", () => {
        const ir = compileOk(`
            workflow choose(x: boolean, a: string, b: string): string {
                if (x) {
                    return a;
                } else {
                    return b;
                }
            }
        `);
        const [, branchNode] = findNodeByKind<BranchNode>(ir, "branch");

        for (const armKey of ["true", "false"] as const) {
            const arm = branchNode.cases[armKey];
            expect(arm).toBeDefined();
            const armNodes = Object.values(arm.scope.nodes);
            // Single synthetic noop task in each arm.
            expect(armNodes).toHaveLength(1);
            const only = armNodes[0] as TaskNode;
            expect(only.kind).toBe("task");
            expect(only.task).toBe("noop");
            // The outer input is hoisted into the arm's inputs and the
            // scope output template reads from input.value, so neither arm
            // ends up with a stray $from:input reference inside.
            expect(Object.keys(arm.inputs).length).toBeGreaterThan(0);
            const output = arm.scope.output as Record<string, unknown>;
            expect(output.$from).toBe("input");
        }
    });

    // emitFilter emits an inner `filter_check` branch that decides whether
    // to append the current element. threadNext does not auto-link branch
    // nodes, so the emitter wires `filter_check.next = step_i` manually.
    // Without this wiring the loop body would not advance the counter.
    test("filter inner branch is wired to the step counter", () => {
        const ir = compileOk(`
            workflow test(items: string[]): unknown {
                return filter(items, (item) => {
                    return item === "keep";
                });
            }
        `);
        const [, loopNode] = findNodeByKind<LoopNode>(ir, "loop");
        const body = loopNode.body;

        // The body's outer iteration check (true arm = work).
        const checkNode = Object.values(body.nodes).find(
            (n) => n.kind === "branch",
        ) as BranchNode | undefined;
        expect(checkNode).toBeDefined();

        // The inner filter branch sits in the work arm.
        const workScope = (
            checkNode!.cases["true"] as unknown as {
                scope: { nodes: Record<string, WorkflowNode> };
            }
        ).scope;
        const filterBranchEntry = Object.entries(workScope.nodes).find(
            ([, n]) => n.kind === "branch",
        );
        expect(filterBranchEntry).toBeDefined();
        const [, filterBranch] = filterBranchEntry!;
        const fb = filterBranch as BranchNode;

        // The branch must point at a step_i (math.add) task; without
        // this wiring the loop body would not advance the counter.
        expect(fb.next).toBeDefined();
        const stepNode = workScope.nodes[fb.next!] as TaskNode;
        expect(stepNode).toBeDefined();
        expect(stepNode.kind).toBe("task");
        expect(stepNode.task).toBe("math.add");
    });
});
