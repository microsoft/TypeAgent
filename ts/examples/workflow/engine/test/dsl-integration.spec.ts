// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DSL → IR → Engine integration tests.
 *
 * Compiles workflow DSL source to IR, then executes it through the engine,
 * verifying end-to-end runtime behavior.
 */

import {
    WorkflowIR,
    TaskDefinition,
} from "workflow-model";
import {
    TaskRegistry,
    WorkflowEngine,
    WorkflowEvent,
    allBuiltinTasks,
} from "../src/index.js";
import {
    compile,
    TaskSchemaInfo,
    CompileOptions,
} from "workflow-dsl";

// ---- Helpers ----

const VALIDATE: CompileOptions = { validate: true };

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

/**
 * Build TaskSchemaInfo[] from TaskDefinition[], so the DSL compiler
 * can look up input/output schemas for each task.
 */
function taskSchemasFrom(tasks: TaskDefinition[]): TaskSchemaInfo[] {
    return tasks.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
    }));
}

/**
 * Compile DSL source to IR, asserting no errors.
 */
function compileOk(
    source: string,
    extraTasks: TaskDefinition[] = [],
): WorkflowIR {
    const schemas = taskSchemasFrom([...allBuiltinTasks, ...extraTasks]);
    const result = compile(source, schemas, VALIDATE);
    if (result.errors.length > 0) {
        throw new Error(
            `Compile errors:\n${result.errors.map((e) => e.message).join("\n")}`,
        );
    }
    return result.ir!;
}

// ---- Tests ----

describe("DSL → Engine integration", () => {
    describe("retry", () => {
        const flakyTask: TaskDefinition = {
            name: "web.fetch",
            sideEffects: false,
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
            // execute is set per-test below
            async execute() {
                return { kind: "ok", output: { body: "" } };
            },
        };

        function makeEngine(execute: TaskDefinition["execute"]) {
            const task: TaskDefinition = { ...flakyTask, execute };
            const builtins = allBuiltinTasks.filter(
                (t) => t.name !== "web.fetch",
            );
            const reg = makeRegistry(...builtins, task);
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);
            return { eng, events };
        }

        const RETRY_SOURCE = `
            workflow fetchWithRetry(url: string): any {
                return retry(3, () => {
                    const result = web.fetch(url)
                    return result
                })
            }
        `;

        function compileRetry(): WorkflowIR {
            return compileOk(RETRY_SOURCE, [flakyTask]);
        }

        it("succeeds on first attempt without retrying", async () => {
            let callCount = 0;
            const { eng, events } = makeEngine(async (input: any) => {
                callCount++;
                return { kind: "ok", output: { body: `page: ${input.url}` } };
            });

            const ir = compileRetry();
            const result = await eng.run(ir, {
                input: { url: "https://example.com" },
            });

            expect(result.success).toBe(true);
            expect(callCount).toBe(1);
            expect(result.output).toBe(
                "page: https://example.com",
            );

            const iterEvents = events.filter(
                (e) => e.type === "loopIterationStarted",
            );
            expect(iterEvents.length).toBe(1);
        });

        it("retries on failure then succeeds", async () => {
            let callCount = 0;
            const { eng, events } = makeEngine(async (input: any) => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        kind: "fail",
                        error: { message: `Attempt ${callCount} failed` },
                    };
                }
                return {
                    kind: "ok",
                    output: { body: `page: ${input.url}` },
                };
            });

            const ir = compileRetry();
            const result = await eng.run(ir, {
                input: { url: "https://flaky.example.com" },
            });

            expect(result.success).toBe(true);
            expect(callCount).toBe(3);
            expect(result.output).toBe(
                "page: https://flaky.example.com",
            );

            const iterEvents = events.filter(
                (e) => e.type === "loopIterationStarted",
            );
            expect(iterEvents.length).toBe(3);
        });

        it("exhausts retries and fails", async () => {
            let callCount = 0;
            const { eng } = makeEngine(async () => {
                callCount++;
                return {
                    kind: "fail",
                    error: { message: `Attempt ${callCount} failed` },
                };
            });

            const ir = compileRetry();
            const result = await eng.run(ir, {
                input: { url: "https://down.example.com" },
            });

            expect(result.success).toBe(false);
            expect(callCount).toBe(3);
        });
    });
});
