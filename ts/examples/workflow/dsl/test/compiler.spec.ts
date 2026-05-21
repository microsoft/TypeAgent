// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, TaskSchemaInfo, CompileOptions } from "../src/index.js";
import { WorkflowIR, WorkflowBody } from "workflow-model";

function bodyOf(ir: WorkflowIR): WorkflowBody {
    return ir.workflows[ir.entry];
}

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
        outputSchema: { type: "string" },
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
        outputSchema: { type: "string" },
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
            required: ["body"],
            properties: { body: { type: "string" } },
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
        outputSchema: { type: "string" },
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
        outputSchema: { type: "string" },
    },
];

describe("DSL lexer", () => {
    it("tokenizes a workflow declaration", () => {
        const source = `workflow hello(name: string): string {
            const greeting = text.template("Hello {{name}}", { name: name });
            return greeting.text;
        }`;
        const { tokens, errors } = lex(source);
        expect(errors).toHaveLength(0);
        expect(tokens[0].kind).toBe("workflow");
        expect(tokens[1].kind).toBe("Identifier");
        expect(tokens[1].value).toBe("hello");
    });

    it("preserves string escape sequences as raw text", () => {
        // Under raw-only AST design the lexer does NOT decode escapes;
        // the captured value is the verbatim source between delimiters.
        const { tokens, errors } = lex(`"hello\\nworld"`);
        expect(errors).toHaveLength(0);
        expect(tokens[0].value).toBe("hello\\nworld");
    });
});

describe("DSL parser", () => {
    it("parses a minimal workflow", () => {
        const source = `workflow hello(name: string): string {
            const greeting = text.template("Hello", { name: name });
            return greeting.text;
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

    it("parses map built-in", () => {
        const source = `workflow test(items: string[]): { text: string }[] {
            const results = map(items, (item) => {
                const x = text.template("{{i}}", { i: item });
                return x;
            });
            return results;
        }`;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { ast, errors } = parser.parseSingle();
        expect(errors).toHaveLength(0);
        expect(ast!.body[0].kind).toBe("ConstStatement");
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
            const greeting = text.template("Hello {{name}}", { name: name });
            return greeting;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        expect(result.ir).toBeDefined();
        const ir = result.ir!;
        expect(ir.kind).toBe("workflow");
        expect(ir.entry).toBe("hello");
        expect(ir.version).toBe("1");
        expect(bodyOf(ir).entry).toBe("greeting");
        expect(bodyOf(ir).nodes["greeting"]).toBeDefined();
        expect(bodyOf(ir).nodes["greeting"].kind).toBe("task");
        const taskNode = bodyOf(ir).nodes["greeting"] as {
            task: string;
            bind: string;
        };
        expect(taskNode.task).toBe("text.template");
        expect(taskNode.bind).toBe("greeting");
    });

    it("generates correct inputSchema from params", () => {
        const source = `workflow test(repos: string[], author: string): string {
            const x = text.template("hi", { name: author });
            return x;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        const schema = bodyOf(result.ir!).inputSchema as Record<
            string,
            unknown
        >;
        expect(schema.type).toBe("object");
        expect(schema.required).toEqual(["repos", "author"]);
        const props = schema.properties as Record<
            string,
            Record<string, unknown>
        >;
        expect(props.repos.type).toBe("array");
        expect(props.author.type).toBe("string");
    });

    it("lowers map to a loop node with index machinery", () => {
        const source = `workflow test(items: string[]): string {
            const results = map(items, (item) => {
                const result = text.template("{{x}}", { x: item });
                return result;
            });
            const joined = string.join(results, ",");
            return joined;
        }`;
        const result = compile(source, TASK_SCHEMAS);
        expect(result.errors).toHaveLength(0);
        const ir = result.ir!;

        // Should have a loop node
        const loopNodes = Object.entries(bodyOf(ir).nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);

        const [_loopId, loopNode] = loopNodes[0];
        const loop = loopNode as {
            kind: string;
            body: { entry: string; nodes: Record<string, unknown> };
            state: Record<string, unknown>;
            maxIterations?: number;
        };
        expect(loop.kind).toBe("loop");
        expect(loop.maxIterations).toBeUndefined();
        expect(loop.state).toHaveProperty("i");
    });

    it("resolves dotted name references", () => {
        const source = `workflow test(url: string): string {
            const a = web.fetch(url);
            const b = text.template("{{x}}", { x: a.body });
            return b;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);

        const nodeB = bodyOf(result.ir!).nodes["b"] as {
            inputs: Record<string, unknown>;
        };
        const varsInput = nodeB.inputs.vars as Record<string, unknown>;
        const xRef = varsInput.x as Record<string, unknown>;
        expect(xRef.$from).toBe("scope");
        expect(xRef.name).toBe("a");
        expect(xRef.path).toEqual(["body"]);
    });

    it("reports errors for unknown tasks", () => {
        const source = `workflow test(x: string): string {
            const a = unknown.task("hi");
            return a;
        }`;
        const result = compile(source, TASK_SCHEMAS);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].message).toContain("Unknown task");
    });

    it("threads next edges between sequential nodes", () => {
        const source = `workflow test(x: string): string {
            const a = text.template("1", { x: x });
            const b = text.template("2", { x: a });
            const c = text.template("3", { x: b });
            return c;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);

        const nodeA = bodyOf(result.ir!).nodes["a"] as { next?: string };
        const nodeB = bodyOf(result.ir!).nodes["b"] as { next?: string };
        expect(nodeA.next).toBe("b");
        expect(nodeB.next).toBe("c");
    });

    it("compiles attempts to a loop node", () => {
        const source = `workflow test(url: string): { body: string } {
            const result = attempts(3, () => {
                const r = web.fetch(url);
                return r;
            });
            return result;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        const ir = result.ir!;

        const loopNodes = Object.entries(bodyOf(ir).nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);
    });

    it("compiles if/else to branch nodes", () => {
        const source = `workflow test(x: boolean): string {
            if (x) {
                const a = web.fetch("https://a.com");
            } else {
                const b = web.fetch("https://b.com");
            }
            return "done";
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        const ir = result.ir!;

        const branchNodes = Object.entries(bodyOf(ir).nodes).filter(
            ([_, n]) => n.kind === "branch",
        );
        expect(branchNodes.length).toBeGreaterThanOrEqual(1);
    });

    it("compiles parallel to a fork node", () => {
        const source = `workflow test(): unknown {
            const results = parallel(
                () => {
                    const a = web.fetch("https://a.com");
                    return a;
                },
                () => {
                    const b = web.fetch("https://b.com");
                    return b;
                }
            );
            return results;
        }`;
        const result = compile(source, TASK_SCHEMAS, VALIDATE);
        expect(result.errors).toHaveLength(0);
        const ir = result.ir!;

        const forkNodes = Object.entries(bodyOf(ir).nodes).filter(
            ([_, n]) => n.kind === "fork",
        );
        expect(forkNodes.length).toBe(1);
    });
});

describe("DSL d1-standup-prep", () => {
    it("compiles the d1-standup-prep.wf example", () => {
        const wfPath = path.resolve(
            __dirname,
            "..",
            "..",
            "..",
            "workflows",
            "dsl",
            "d1-standup-prep.wf",
        );
        const source = fs.readFileSync(wfPath, "utf-8");
        const result = compile(source, TASK_SCHEMAS, VALIDATE);

        expect(result.errors).toHaveLength(0);
        expect(result.ir).toBeDefined();
        const ir = result.ir!;

        // Top-level structure
        expect(ir.entry).toBe("standupPrep");
        expect(ir.version).toBe("1");
        const schema = bodyOf(ir).inputSchema as Record<string, unknown>;
        expect(schema.required).toEqual(["repos", "author"]);

        // Should have a loop node (from map)
        const loopNodes = Object.entries(bodyOf(ir).nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);

        // Post-loop: joined task should reference the loop's output
        expect(bodyOf(ir).nodes["joined"]).toBeDefined();
        const joinedNode = bodyOf(ir).nodes["joined"] as {
            task: string;
        };
        expect(joinedNode.task).toBe("string.join");

        // Output should reference joined
        const output = bodyOf(ir).output as Record<string, unknown>;
        expect(output.$from).toBe("scope");
        expect(output.name).toBe("joined");
    });
});

describe("DSL d8-summarize-url", () => {
    it("compiles the d8-summarize-url.wf example", () => {
        const wfPath = path.resolve(
            __dirname,
            "..",
            "..",
            "..",
            "workflows",
            "dsl",
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
        expect(ir.entry).toBe("summarizeUrl");
        expect(ir.version).toBe("1");
        const schema = bodyOf(ir).inputSchema as Record<string, unknown>;
        expect(schema.required).toEqual(["url", "outputPath"]);

        // Should have a loop node (from attempts)
        const loopNodes = Object.entries(bodyOf(ir).nodes).filter(
            ([_, n]) => n.kind === "loop",
        );
        expect(loopNodes.length).toBe(1);

        // Post-loop: should have prompt, summaryResult, writeResult
        expect(bodyOf(ir).nodes["prompt"]).toBeDefined();
        expect(bodyOf(ir).nodes["summaryResult"]).toBeDefined();
        expect(bodyOf(ir).nodes["writeResult"]).toBeDefined();

        // Output should be an object
        const output = bodyOf(ir).output as Record<string, unknown>;
        expect(output).toBeDefined();
    });
});
