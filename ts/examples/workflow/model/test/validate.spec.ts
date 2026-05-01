// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowSpec,
    TaskDefinition,
    validateWorkflowSpec,
} from "../src/index.js";

function makeMinimalSpec(overrides?: Partial<WorkflowSpec>): WorkflowSpec {
    return {
        specVersion: 1,
        name: "test-workflow",
        version: "1",
        input: { type: "object", properties: {} },
        output: { type: "object", properties: {} },
        entry: "start",
        nodes: {
            start: { task: "noop" },
        },
        ...overrides,
    };
}

function makeTask(name: string, branchLabels?: string[]): TaskDefinition {
    const def: TaskDefinition = {
        name,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        execute: async () => ({ kind: "ok" as const, output: {} }),
    };
    if (branchLabels) {
        def.branchLabels = branchLabels;
    }
    return def;
}

describe("validateWorkflowSpec", () => {
    it("accepts a minimal valid spec", () => {
        const result = validateWorkflowSpec(makeMinimalSpec());
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("rejects unsupported specVersion", () => {
        const result = validateWorkflowSpec(
            makeMinimalSpec({ specVersion: 99 }),
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0].path).toBe("specVersion");
    });

    it("rejects missing entry node", () => {
        const result = validateWorkflowSpec(
            makeMinimalSpec({ entry: "nonexistent" }),
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0].path).toBe("entry");
    });

    it("rejects invalid next target", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: { task: "noop", next: "missing" },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("missing");
    });

    it("rejects invalid onError target", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: { task: "noop", onError: "missing" },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("missing");
    });

    it("rejects inputMap paths with invalid prefixes", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: {
                    task: "noop",
                    inputMap: { field: "bad.path" },
                },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("Invalid path");
    });

    it("rejects inputMap node paths referencing non-existent nodes", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: {
                    task: "noop",
                    inputMap: { field: "nodes.ghost.output.value" },
                },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("ghost");
    });

    it("rejects malformed node paths", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: {
                    task: "noop",
                    inputMap: { field: "nodes.a.b" },
                },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("Expected format");
    });

    it("accepts valid inputMap paths", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: {
                    task: "noop",
                    inputMap: {
                        a: "input.topic",
                        b: "variables.maxItems",
                        c: "nodes.start.output.result",
                    },
                },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(true);
    });

    it("accepts a multi-node linear workflow", () => {
        const spec = makeMinimalSpec({
            entry: "a",
            nodes: {
                a: { task: "noop", next: "b" },
                b: { task: "noop", next: "c" },
                c: { task: "noop" },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(true);
    });

    describe("with task registry", () => {
        it("rejects unregistered tasks", () => {
            const tasks = new Map<string, TaskDefinition>();
            const result = validateWorkflowSpec(makeMinimalSpec(), tasks);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("not registered");
        });

        it("validates decision node branch labels match task", () => {
            const tasks = new Map<string, TaskDefinition>([
                ["branch-task", makeTask("branch-task", ["yes", "no"])],
            ]);
            const spec = makeMinimalSpec({
                nodes: {
                    start: {
                        task: "branch-task",
                        next: { yes: "start", no: "start" },
                    },
                },
            });
            const result = validateWorkflowSpec(spec, tasks);
            expect(result.valid).toBe(true);
        });

        it("rejects missing branch label in next", () => {
            const tasks = new Map<string, TaskDefinition>([
                ["branch-task", makeTask("branch-task", ["yes", "no"])],
            ]);
            const spec = makeMinimalSpec({
                nodes: {
                    start: {
                        task: "branch-task",
                        next: { yes: "start" },
                    },
                },
            });
            const result = validateWorkflowSpec(spec, tasks);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("no");
        });

        it("rejects extra branch label not declared by task", () => {
            const tasks = new Map<string, TaskDefinition>([
                ["branch-task", makeTask("branch-task", ["yes"])],
            ]);
            const spec = makeMinimalSpec({
                nodes: {
                    start: {
                        task: "branch-task",
                        next: { yes: "start", extra: "start" },
                    },
                },
            });
            const result = validateWorkflowSpec(spec, tasks);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("extra");
        });

        it("rejects linear next on a task with branchLabels", () => {
            const tasks = new Map<string, TaskDefinition>([
                ["branch-task", makeTask("branch-task", ["a", "b"])],
            ]);
            const spec = makeMinimalSpec({
                nodes: {
                    start: { task: "branch-task", next: "start" },
                },
            });
            const result = validateWorkflowSpec(spec, tasks);
            expect(result.valid).toBe(false);
            expect(result.errors[0].message).toContain("branchLabels");
        });
    });

    it("accepts a complete example workflow", () => {
        const spec: WorkflowSpec = {
            specVersion: 1,
            name: "weekly-news-digest",
            version: "1",
            input: {
                type: "object",
                properties: { topic: { type: "string" } },
                required: ["topic"],
            },
            output: {
                type: "object",
                properties: { digest: { type: "string" } },
            },
            variables: {
                maxArticles: 10,
                urlTemplate: "https://news/api?q={topic}",
            },
            entry: "buildUrl",
            nodes: {
                buildUrl: {
                    task: "string.template",
                    inputMap: {
                        template: "variables.urlTemplate",
                        topic: "input.topic",
                    },
                    next: "fetch",
                },
                fetch: {
                    task: "http.get",
                    inputMap: { url: "nodes.buildUrl.output.result" },
                    next: "summarize",
                    onError: "handleError",
                },
                summarize: {
                    task: "llm.summarize",
                    inputMap: {
                        text: "nodes.fetch.output.body",
                        maxItems: "variables.maxArticles",
                    },
                    next: "publish",
                },
                publish: {
                    task: "publish",
                    inputMap: {
                        digest: "nodes.summarize.output.summary",
                    },
                },
                handleError: {
                    task: "log.error",
                },
            },
        };
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(true);
    });

    it("round-trips through JSON serialization", () => {
        const spec = makeMinimalSpec({
            variables: { count: 5 },
            nodes: {
                start: {
                    task: "noop",
                    inputMap: { n: "variables.count" },
                },
            },
        });
        const json = JSON.stringify(spec);
        const parsed: WorkflowSpec = JSON.parse(json);
        expect(parsed).toEqual(spec);

        const result = validateWorkflowSpec(parsed);
        expect(result.valid).toBe(true);
    });

    it("rejects unreachable nodes", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: { task: "noop" },
                orphan: { task: "noop" },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes("not reachable")),
        ).toBe(true);
    });

    it("accepts error-handler nodes as reachable via onError", () => {
        const spec = makeMinimalSpec({
            nodes: {
                start: { task: "noop", onError: "handler" },
                handler: { task: "noop" },
            },
        });
        const result = validateWorkflowSpec(spec);
        expect(result.valid).toBe(true);
    });
});
