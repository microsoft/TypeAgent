// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, TaskSchemaInfo, CompileOptions } from "../src/index.js";

const VALIDATE: CompileOptions = { validate: true };
import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Task schemas extracted from builtinTasks.ts, just enough for the
 * compiler to fill in inputSchema/outputSchema on IR nodes.
 */
const TASK_SCHEMAS: TaskSchemaInfo[] = [
    {
        name: "text.template",
        inputSchema: {
            type: "object",
            required: ["template", "vars"],
            properties: {
                template: { type: "string" },
                vars: { type: "object" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
        },
    },
    {
        name: "shell.exec",
        inputSchema: {
            type: "object",
            required: ["command"],
            properties: {
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
                cwd: { type: "string" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["stdout", "stderr", "exitCode"],
            properties: {
                stdout: { type: "string" },
                stderr: { type: "string" },
                exitCode: { type: "integer" },
            },
        },
    },
    {
        name: "string.join",
        inputSchema: {
            type: "object",
            required: ["list", "delimiter"],
            properties: {
                list: { type: "array", items: { type: "string" } },
                delimiter: { type: "string" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
        },
    },
    {
        name: "list.append",
        inputSchema: {
            type: "object",
            required: ["list", "item"],
            properties: { list: { type: "array" }, item: {} },
        },
        outputSchema: {
            type: "object",
            required: ["list"],
            properties: { list: { type: "array" } },
        },
    },
    {
        name: "list.elementAt",
        inputSchema: {
            type: "object",
            required: ["list", "index"],
            properties: {
                list: { type: "array" },
                index: { type: "integer" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["element"],
            properties: { element: {} },
        },
    },
    {
        name: "list.length",
        inputSchema: {
            type: "object",
            required: ["list"],
            properties: { list: { type: "array" } },
        },
        outputSchema: {
            type: "object",
            required: ["length"],
            properties: { length: { type: "integer" } },
        },
    },
    {
        name: "int.add",
        inputSchema: {
            type: "object",
            required: ["a", "b"],
            properties: { a: { type: "integer" }, b: { type: "integer" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "integer" } },
        },
    },
    {
        name: "int.lessThan",
        inputSchema: {
            type: "object",
            required: ["a", "b"],
            properties: { a: { type: "integer" }, b: { type: "integer" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "boolean" } },
        },
    },
    {
        name: "bool.toLabel",
        inputSchema: {
            type: "object",
            required: ["value", "ifTrue", "ifFalse"],
            properties: {
                value: { type: "boolean" },
                ifTrue: { type: "string" },
                ifFalse: { type: "string" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["label"],
            properties: { label: { type: "string" } },
        },
    },
];

// Additional schemas for d8-summarize-url
const D8_SCHEMAS: TaskSchemaInfo[] = [
    ...TASK_SCHEMAS,
    {
        name: "http.get",
        inputSchema: {
            type: "object",
            required: ["url"],
            properties: { url: { type: "string" } },
        },
        outputSchema: {
            type: "object",
            required: ["body", "status"],
            properties: {
                body: { type: "string" },
                status: { type: "integer" },
            },
        },
    },
    {
        name: "llm.generate",
        inputSchema: {
            type: "object",
            required: ["prompt"],
            properties: { prompt: { type: "string" } },
        },
        outputSchema: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
        },
    },
    {
        name: "file.write",
        inputSchema: {
            type: "object",
            required: ["path", "content"],
            properties: {
                path: { type: "string" },
                content: { type: "string" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["path"],
            properties: { path: { type: "string" } },
        },
    },
];

describe("DSL lexer", () => {
    it("tokenizes a workflow declaration", () => {
        const source = `workflow hello(name: string): string {
            let result = text.template("Hello {{name}}", { name: name });
            return result.text;
        }`;
        const { tokens, errors } = lex(source);
        expect(errors).toHaveLength(0);
        expect(tokens[0].kind).toBe("workflow");
        expect(tokens[1].kind).toBe("Identifier");
        expect(tokens[1].value).toBe("hello");
    });

    it("handles string escapes", () => {
        const { tokens, errors } = lex(`"hello\\nworld"`);
        expect(errors).toHaveLength(0);
        expect(tokens[0].value).toBe("hello\nworld");
    });
});

describe("DSL parser", () => {
    it("parses a minimal workflow", () => {
        const source = `workflow hello(name: string): string {
            let result = text.template("Hello", { name: name });
            return result.text;
        }`;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { ast, errors } = parser.parseSingle();
        expect(errors).toHaveLength(0);
        expect(ast).toBeDefined();
        expect(ast!.name).toBe("hello");
        expect(ast!.params).toHaveLength(1);
        expect(ast!.params[0].name).toBe("name");
        expect(ast!.body).toHaveLength(2);
    });

    it("parses for..of loops", () => {
        const source = `workflow test(items: string[]): string {
            for (item of items) {
                let x = text.template("{{i}}", { i: item });
            }
            return items;
        }`;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { ast, errors } = parser.parseSingle();
        expect(errors).toHaveLength(0);
        expect(ast!.body[0].kind).toBe("ForOfStatement");
    });

    it("parses object type annotations", () => {
        const source = `workflow test(data: { name: string, age: integer }): string {
            return data;
        }`;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { ast, errors } = parser.parseSingle();
        expect(errors).toHaveLength(0);
        const paramType = ast!.params[0].type;
        expect(paramType.kind).toBe("ObjectType");
    });
});

describe("DSL compiler", () => {
    it("compiles a minimal workflow to IR", () => {
        const source = `workflow hello(name: string): string {
            let greeting = text.template("Hello {{name}}", { name: name });
            return greeting.text;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        expect(result.ir).toBeDefined();
        const ir = result.ir!;
        expect(ir.kind).toBe("workflow");
        expect(ir.name).toBe("hello");
        expect(ir.version).toBe("1");
        expect(ir.entry).toBe("greeting");
        expect(ir.nodes["greeting"]).toBeDefined();
        expect(ir.nodes["greeting"].kind).toBe("task");
        const taskNode = ir.nodes["greeting"] as { task: string; bind: string };
        expect(taskNode.task).toBe("text.template");
        expect(taskNode.bind).toBe("greeting");
    });

    it("generates correct inputSchema from params", () => {
        const source = `workflow test(repos: string[], author: string): string {
            let x = text.template("hi", { name: author });
            return x.text;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        const schema = result.ir!.inputSchema as Record<string, unknown>;
        expect(schema.type).toBe("object");
        expect(schema.required).toEqual(["repos", "author"]);
        const props = schema.properties as Record<
            string,
            Record<string, unknown>
        >;
        expect(props.repos.type).toBe("array");
        expect(props.author.type).toBe("string");
    });

    it("lowers for..of to a loop node with index machinery", () => {
        const source = `workflow test(items: string[]): string {
            for (item of items) {
                let result = text.template("{{x}}", { x: item });
            }
            let joined = string.join(items, ",");
            return joined.text;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        const ir = result.ir!;

        // Should have a loop node
        const loopNodes = Object.entries(ir.nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);

        const [_loopId, loopNode] = loopNodes[0];
        const loop = loopNode as {
            kind: string;
            body: { entry: string; nodes: Record<string, unknown> };
            state: Record<string, unknown>;
            maxIterations: number;
        };
        expect(loop.kind).toBe("loop");
        expect(loop.maxIterations).toBe(100);
        expect(loop.state).toHaveProperty("i");

        // Body should have: pick, the user's task, step_i, compute_length, compare_index, check_done
        const bodyNodeIds = Object.keys(loop.body.nodes);
        expect(bodyNodeIds).toContain("pick_item");
        expect(bodyNodeIds).toContain("step_i");
        expect(bodyNodeIds).toContain("compute_length");
        expect(bodyNodeIds).toContain("compare_index");
        expect(bodyNodeIds).toContain("check_done");
    });

    it("resolves dotted name references", () => {
        const source = `workflow test(name: string): string {
            let a = text.template("{{x}}", { x: name });
            let b = text.template("{{x}}", { x: a.text });
            return b.text;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);

        const nodeB = result.ir!.nodes["b"] as {
            inputs: Record<string, unknown>;
        };
        const varsInput = nodeB.inputs.vars as Record<string, unknown>;
        const xRef = varsInput.x as Record<string, unknown>;
        expect(xRef.$from).toBe("scope");
        expect(xRef.name).toBe("a");
        expect(xRef.path).toEqual(["text"]);
    });

    it("reports errors for unknown tasks", () => {
        const source = `workflow test(x: string): string {
            let a = unknown.task("hi");
            return a.text;
        }`;
        const result = compile(source, TASK_SCHEMAS);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].phase).toBe("emit");
        expect(result.errors[0].message).toContain("Unknown task");
    });

    it("threads next edges between sequential nodes", () => {
        const source = `workflow test(x: string): string {
            let a = text.template("1", { x: x });
            let b = text.template("2", { x: a.text });
            let c = text.template("3", { x: b.text });
            return c.text;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);

        const nodeA = result.ir!.nodes["a"] as { next?: string };
        const nodeB = result.ir!.nodes["b"] as { next?: string };
        expect(nodeA.next).toBe("b");
        expect(nodeB.next).toBe("c");
    });
});

describe("DSL d1-standup-prep", () => {
    it("compiles the d1-standup-prep.wf example", () => {
        const wfPath = path.resolve(
            __dirname,
            "..",
            "..",
            "examples",
            "d1-standup-prep.wf",
        );
        const source = fs.readFileSync(wfPath, "utf-8");
        const result = compile(source, TASK_SCHEMAS, VALIDATE);

        expect(result.errors).toHaveLength(0);
        expect(result.ir).toBeDefined();
        const ir = result.ir!;

        // Top-level structure
        expect(ir.name).toBe("standupPrep");
        expect(ir.version).toBe("1");
        const schema = ir.inputSchema as Record<string, unknown>;
        expect(schema.required).toEqual(["repos", "author"]);

        // Should have: authorArg task, then a loop node, then joined task
        expect(ir.nodes["authorArg"]).toBeDefined();
        expect(ir.nodes["authorArg"].kind).toBe("task");

        // Loop node
        const loopNodes = Object.entries(ir.nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);
        const [loopId, loopNode] = loopNodes[0];
        const loop = loopNode as {
            kind: string;
            inputs: Record<string, unknown>;
            state: Record<string, { initial: unknown }>;
            body: { entry: string; nodes: Record<string, unknown> };
            iterateState: Record<string, unknown>;
            output: unknown;
        };

        // Loop should bring in authorArg as an outer ref
        expect(loop.inputs).toHaveProperty("authorArg");

        // Loop state should have i (index) and sections (accumulator)
        expect(loop.state).toHaveProperty("i");
        expect(loop.state).toHaveProperty("sections");
        expect(loop.state.sections.initial).toEqual([]);

        // Loop body should have the user's task nodes + infrastructure
        const bodyNodeIds = Object.keys(loop.body.nodes);
        expect(bodyNodeIds).toContain("pick_repo");
        expect(bodyNodeIds).toContain("gitResult");
        expect(bodyNodeIds).toContain("section");
        expect(bodyNodeIds).toContain("assign_sections");
        expect(bodyNodeIds).toContain("step_i");
        expect(bodyNodeIds).toContain("check_done");

        // The list.append node should reference state.sections
        const appendNode = loop.body.nodes["assign_sections"] as {
            task: string;
            inputs: Record<string, unknown>;
        };
        expect(appendNode.task).toBe("list.append");
        const listInput = appendNode.inputs.list as Record<string, unknown>;
        expect(listInput.$from).toBe("state");
        expect(listInput.name).toBe("sections");

        // iterateState should carry sections forward
        expect(loop.iterateState).toHaveProperty("sections");

        // Post-loop: joined task should reference the loop's output
        expect(ir.nodes["joined"]).toBeDefined();
        const joinedNode = ir.nodes["joined"] as {
            task: string;
            inputs: Record<string, unknown>;
        };
        expect(joinedNode.task).toBe("string.join");
        const listRef = joinedNode.inputs.list as Record<string, unknown>;
        expect(listRef.$from).toBe("scope");
        expect(listRef.name).toBe(loopId);

        // Output should reference joined.text
        const output = ir.output as Record<string, unknown>;
        expect(output.$from).toBe("scope");
        expect(output.name).toBe("joined");
        expect(output.path).toEqual(["text"]);
    });
});

describe("DSL d8-summarize-url", () => {
    it("compiles the d8-summarize-url.wf example", () => {
        const wfPath = path.resolve(
            __dirname,
            "..",
            "..",
            "examples",
            "d8-summarize-url.wf",
        );
        const source = fs.readFileSync(wfPath, "utf-8");
        const result = compile(source, D8_SCHEMAS, VALIDATE);

        if (result.errors.length > 0) {
            console.error("d8 errors:", result.errors);
        }
        expect(result.errors).toHaveLength(0);
        expect(result.ir).toBeDefined();
        const ir = result.ir!;

        // Top-level structure
        expect(ir.name).toBe("summarizeUrl");
        expect(ir.version).toBe("1");
        const schema = ir.inputSchema as Record<string, unknown>;
        expect(schema.required).toEqual(["url", "outputPath"]);

        // Should have constants
        expect(ir.constants).toBeDefined();
        expect(ir.constants!["summaryPrompt"]).toBeDefined();
        expect(ir.constants!["maxRetries"]).toBeDefined();

        // Should have a loop node (while true)
        const loopNodes = Object.entries(ir.nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);
        const [_loopId, loopNode] = loopNodes[0];
        const loop = loopNode as {
            kind: string;
            state: Record<string, unknown>;
            body: { entry: string; nodes: Record<string, unknown> };
            maxIterations: number;
        };
        expect(loop.maxIterations).toBe(100);

        // Loop state should have attempt
        expect(loop.state).toHaveProperty("attempt");

        // Loop body should have branch nodes for try/catch and if
        const bodyNodes = loop.body.nodes;
        const branchNodes = Object.entries(bodyNodes).filter(
            ([_, n]) => (n as { kind: string }).kind === "branch",
        );
        expect(branchNodes.length).toBeGreaterThanOrEqual(1);

        // Post-loop: should have prompt, summaryResult, writeResult
        expect(ir.nodes["prompt"]).toBeDefined();
        expect(ir.nodes["summaryResult"]).toBeDefined();
        expect(ir.nodes["writeResult"]).toBeDefined();

        // Output should be an object with path and summary
        const output = ir.output as Record<string, unknown>;
        expect(output).toBeDefined();
    });
});

describe("DSL try/catch single-trigger compliance", () => {
    it("clones catch body per trigger when try has multiple tasks", () => {
        const source = `workflow multiFetch(u1: string, u2: string): string {
            let result: string;
            while (true) {
                try {
                    let a = http.get({ url: u1 });
                    let b = http.get({ url: u2 });
                    result = b.body;
                    break;
                } catch {
                    break;
                }
            }
            return result;
        }`;
        const result = compile(source, D8_SCHEMAS, VALIDATE);
        if (result.errors.length > 0) {
            console.error("multi-trigger errors:", result.errors);
        }
        expect(result.errors).toHaveLength(0);

        const ir = result.ir!;
        const loopNodes = Object.entries(ir.nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);
        const loop = loopNodes[0][1] as {
            body: { nodes: Record<string, { onError?: string; kind: string }> };
        };

        // Find task nodes with onError
        const tasksWithOnError = Object.entries(loop.body.nodes).filter(
            ([_, n]) => n.kind === "task" && n.onError,
        );

        // Each trigger should point to a DIFFERENT recovery entry
        expect(tasksWithOnError.length).toBe(2);
        const targets = tasksWithOnError.map(([_, n]) => n.onError);
        expect(targets[0]).not.toBe(targets[1]);

        // Both recovery entries should exist in the body
        for (const t of targets) {
            expect(loop.body.nodes[t!]).toBeDefined();
        }
    });
});
