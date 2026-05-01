// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WorkflowSpec, TaskDefinition } from "workflow-model";
import {
    TaskRegistry,
    WorkflowEngine,
    WorkflowEvent,
    passthroughTask,
    stringTemplateTask,
    logTask,
    thresholdBranchTask,
} from "../src/index.js";

function makeRegistry(...tasks: TaskDefinition[]): TaskRegistry {
    const registry = new TaskRegistry();
    for (const t of tasks) {
        registry.register(t);
    }
    return registry;
}

function collectEvents(engine: WorkflowEngine): WorkflowEvent[] {
    const events: WorkflowEvent[] = [];
    engine.on((e) => events.push(e));
    return events;
}

// A simple task that doubles a number
const doubleTask: TaskDefinition<{ value: number }, { value: number }> = {
    name: "double",
    inputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
    },
    outputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
    },
    async execute(input) {
        return { kind: "ok", output: { value: input.value * 2 } };
    },
};

// A task that always fails
const failTask: TaskDefinition = {
    name: "always-fail",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    async execute() {
        return {
            kind: "fail",
            error: { message: "intentional failure", data: { code: 42 } },
        };
    },
};

// A task that throws
const throwTask: TaskDefinition = {
    name: "always-throw",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    async execute() {
        throw new Error("kaboom");
    },
};

describe("WorkflowEngine", () => {
    describe("linear workflows", () => {
        it("runs a single-node workflow", async () => {
            const registry = makeRegistry(passthroughTask);
            const engine = new WorkflowEngine(registry);
            const events = collectEvents(engine);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "single",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "start",
                nodes: {
                    start: { task: "passthrough" },
                },
            };

            const result = await engine.run(spec, {
                input: { hello: "world" },
            });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ hello: "world" });
            expect(events.map((e) => e.type)).toEqual([
                "runStarted",
                "nodeStarted",
                "nodeCompleted",
                "runCompleted",
            ]);
        });

        it("runs a multi-node linear workflow with inputMap", async () => {
            const registry = makeRegistry(doubleTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "double-twice",
                version: "1",
                input: {
                    type: "object",
                    properties: { n: { type: "number" } },
                },
                output: { type: "object" },
                entry: "first",
                nodes: {
                    first: {
                        task: "double",
                        inputMap: { value: "input.n" },
                        next: "second",
                    },
                    second: {
                        task: "double",
                        inputMap: { value: "nodes.first.output.value" },
                    },
                },
            };

            const result = await engine.run(spec, { input: { n: 3 } });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ value: 12 }); // 3*2*2
        });

        it("resolves variables in inputMap", async () => {
            const registry = makeRegistry(doubleTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "var-test",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                variables: { seed: 7 },
                entry: "start",
                nodes: {
                    start: {
                        task: "double",
                        inputMap: { value: "variables.seed" },
                    },
                },
            };

            const result = await engine.run(spec);
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ value: 14 });
        });

        it("uses pipeline mode when inputMap is omitted", async () => {
            const registry = makeRegistry(passthroughTask, doubleTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "pipeline",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "a",
                nodes: {
                    a: {
                        task: "double",
                        inputMap: { value: "input.n" },
                        next: "b",
                    },
                    b: { task: "passthrough" }, // no inputMap -> gets a's output
                },
            };

            const result = await engine.run(spec, { input: { n: 5 } });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ value: 10 });
        });
    });

    describe("decision nodes", () => {
        it("branches based on task result", async () => {
            const registry = makeRegistry(thresholdBranchTask, passthroughTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "branching",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "decide",
                nodes: {
                    decide: {
                        task: "threshold.branch",
                        inputMap: { value: "input.score" },
                        next: { high: "good", low: "bad" },
                    },
                    good: {
                        task: "passthrough",
                        inputMap: { result: "input.score" },
                    },
                    bad: {
                        task: "passthrough",
                        inputMap: { result: "input.score" },
                    },
                },
            };

            const highResult = await engine.run(spec, {
                input: { score: 0.9 },
            });
            expect(highResult.success).toBe(true);

            const lowResult = await engine.run(spec, {
                input: { score: 0.2 },
            });
            expect(lowResult.success).toBe(true);
        });
    });

    describe("error handling", () => {
        it("returns failure when a task returns kind: fail", async () => {
            const registry = makeRegistry(failTask);
            const engine = new WorkflowEngine(registry);
            const events = collectEvents(engine);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "fail-test",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "start",
                nodes: { start: { task: "always-fail" } },
            };

            const result = await engine.run(spec);
            expect(result.success).toBe(false);
            expect(result.error?.message).toBe("intentional failure");
            expect(events.some((e) => e.type === "nodeFailed")).toBe(true);
            expect(events.some((e) => e.type === "runFailed")).toBe(true);
        });

        it("catches thrown exceptions and treats as fail", async () => {
            const registry = makeRegistry(throwTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "throw-test",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "start",
                nodes: { start: { task: "always-throw" } },
            };

            const result = await engine.run(spec);
            expect(result.success).toBe(false);
            expect(result.error?.message).toBe("kaboom");
        });

        it("routes to onError node on failure", async () => {
            const registry = makeRegistry(failTask, logTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "error-handler",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "start",
                nodes: {
                    start: {
                        task: "always-fail",
                        onError: "handler",
                    },
                    handler: { task: "log.error" },
                },
            };

            const result = await engine.run(spec);
            expect(result.success).toBe(false);
            expect(result.error?.nodeId).toBe("start");
        });
    });

    describe("cancellation", () => {
        it("stops on abort signal", async () => {
            const registry = makeRegistry(passthroughTask);
            const engine = new WorkflowEngine(registry);
            const controller = new AbortController();
            controller.abort(); // pre-abort

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "cancel-test",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "start",
                nodes: { start: { task: "passthrough" } },
            };

            const result = await engine.run(spec, {
                signal: controller.signal,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("cancelled");
        });
    });

    describe("string.template built-in", () => {
        it("replaces placeholders in template", async () => {
            const registry = makeRegistry(stringTemplateTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "template-test",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                variables: {
                    urlTemplate:
                        "https://api.example.com?q={query}&limit={limit}",
                },
                entry: "build",
                nodes: {
                    build: {
                        task: "string.template",
                        inputMap: {
                            template: "variables.urlTemplate",
                            query: "input.q",
                            limit: "input.max",
                        },
                    },
                },
            };

            const result = await engine.run(spec, {
                input: { q: "news", max: 10 },
            });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({
                result: "https://api.example.com?q=news&limit=10",
            });
        });
    });

    describe("validation", () => {
        it("rejects invalid specs before running", async () => {
            const registry = makeRegistry(passthroughTask);
            const engine = new WorkflowEngine(registry);

            const spec: WorkflowSpec = {
                specVersion: 1,
                name: "bad",
                version: "1",
                input: { type: "object" },
                output: { type: "object" },
                entry: "missing",
                nodes: {},
            };

            const result = await engine.run(spec);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("validation failed");
        });
    });
});
