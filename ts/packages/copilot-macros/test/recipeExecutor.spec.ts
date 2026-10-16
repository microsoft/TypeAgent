// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compileRecipeProgram } from "@typeagent/copilot-macros/recipeCompiler";
import type {
    RecipeArtifact,
    RecipeCallOutcome,
    RecipeHost,
    RecipeSemanticOutcome,
} from "@typeagent/copilot-macros/recipeCore";
import {
    recipeDigest,
    recipeSchemaDigest,
    sealRecipeArtifact,
} from "@typeagent/copilot-macros/recipeCore";
import {
    executeRecipeProgram,
    type RecipeExecutorOptions,
} from "@typeagent/copilot-macros/recipeExecutor";
import type { RecipeExecutionContext } from "@typeagent/copilot-macros/recipeRouting";
import { recipeArtifact } from "./recipeCatalogFixtures.js";

const capability = {
    id: "read",
    transport: "native" as const,
    providerId: "test",
    operation: "read",
    contractVersion: "1",
    inputSchema: { type: "null" as const },
    outputSchema: { type: "string" as const },
    schemaDigest: recipeSchemaDigest({ type: "null" }, { type: "string" }),
    compatibility: "exact" as const,
    effect: "read" as const,
};

function program(
    source: string,
    change: Partial<Omit<RecipeArtifact, "revision">> = {},
): RecipeArtifact {
    return recipeArtifact("program", "capture", {
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: compileRecipeProgram(source),
        inputSchema: { type: "null" },
        capabilities: [capability],
        ...change,
    });
}

function execution(
    invoke: RecipeHost["invokeCapability"] = async () => ({
        status: "completed",
        value: "fresh",
    }),
): RecipeExecutionContext {
    return {
        runId: "run",
        binding: {
            workspaceId: "workspace",
            profileId: "profile",
            providerId: "test",
            accountId: "account",
            sessionId: "session",
            generation: "1",
        },
        signal: new AbortController().signal,
        host: {
            inspectCapability: async (requirement) => ({
                status: "available",
                capability: requirement,
            }),
            invokeCapability: invoke,
            invokeSemantic: async () => ({
                status: "abstained",
                reason: "fixture",
            }),
        },
    };
}

const readSource = `async function execute(api, params) {
    return await api.tools.call("read", null);
}`;

describe("contained recipe executor", () => {
    it("executes fresh host calls on both runs and awaits durable checkpoints", async () => {
        let calls = 0;
        const events: string[] = [];
        const artifact = program(readSource);
        const context = execution(async () => {
            events.push("invoke");
            return { status: "completed", value: `fresh-${++calls}` };
        });
        const options: RecipeExecutorOptions = {
            onCheckpoint: async (checkpoint) => {
                events.push(checkpoint.phase);
            },
        };
        const first = await executeRecipeProgram(
            artifact,
            null,
            context,
            options,
        );
        const second = await executeRecipeProgram(
            artifact,
            null,
            { ...context, runId: "run-2" },
            options,
        );
        expect(first.status).toBe("completed");
        expect(first.output).toBe("fresh-1");
        expect(second.output).toBe("fresh-2");
        expect(first.checkpoints[0].phase).toBe("completed");
        expect(second.completedCallIds).toEqual(["run-2:1"]);
        expect(events.slice(0, 4)).toEqual([
            "not_dispatched",
            "dispatched",
            "invoke",
            "completed",
        ]);
    });

    it.each<RecipeCallOutcome>([
        { status: "denied", code: "permission", message: "No permission" },
        { status: "unavailable", code: "missing", message: "Missing" },
        {
            status: "requires_interaction",
            interactionId: "approve",
            prompt: "Approve",
        },
        {
            status: "execution_uncertain",
            operationId: "operation",
            message: "Unknown",
        },
    ])(
        "preserves $status and stops all subsequent guest calls",
        async (outcome) => {
            let calls = 0;
            const artifact = program(`async function execute(api, params) {
            try { await api.tools.call("read", null); } catch {}
            return await api.tools.call("read", null);
        }`);
            const result = await executeRecipeProgram(
                artifact,
                null,
                execution(async () => {
                    calls++;
                    return outcome;
                }),
            );
            expect(result.status).toBe(outcome.status);
            expect(result.fallback).toBe("never");
            expect(calls).toBe(1);
            if (outcome.status === "requires_interaction")
                expect(result.interactionId).toBe("approve");
            if (outcome.status === "execution_uncertain")
                expect(result.checkpoints[0].operationId).toBe("operation");
        },
    );

    it("fails closed on undeclared calls and schema mismatch", async () => {
        let calls = 0;
        const context = execution(async () => {
            calls++;
            return { status: "completed", value: "value" };
        });
        for (const source of [
            `async function execute(api, params) { return api.tools.call("undeclared", null); }`,
            `async function execute(api, params) { return api.semantic.call("undeclared", null); }`,
            `async function execute(api, params) { return api.tools.call("read", "invalid"); }`,
        ]) {
            const result = await executeRecipeProgram(
                program(source),
                null,
                context,
            );
            expect(result.status).not.toBe("completed");
        }
        expect(calls).toBe(0);
    });

    it.each([
        `return { missing: undefined } as unknown as JsonValue;`,
        `return NaN;`,
        `return 42;`,
        `return new Date() as unknown as JsonValue;`,
    ])("rejects non-JSON or wrong-schema output: %s", async (body) => {
        const artifact = program(
            `async function execute(api, params) { ${body} }`,
        );
        expect(
            (await executeRecipeProgram(artifact, null, execution())).status,
        ).toBe("failed");
    });

    it("checks availability, exact contracts, and host output schema", async () => {
        const artifact = program(readSource);
        const context = execution();
        context.host.inspectCapability = async () => ({
            status: "unavailable",
            message: "Gone",
        });
        expect(
            (await executeRecipeProgram(artifact, null, context)).status,
        ).toBe("unavailable");
        context.host.inspectCapability = async () => ({
            status: "available",
            capability: { ...capability, operation: "changed" },
        });
        expect(
            (await executeRecipeProgram(artifact, null, context)).status,
        ).toBe("unsupported");
        const invalid = execution(async () => ({
            status: "completed",
            value: 42,
        }));
        expect(
            (await executeRecipeProgram(artifact, null, invalid)).status,
        ).toBe("failed");
    });

    it("suppresses late completion and aborts the host signal", async () => {
        const controller = new AbortController();
        let hostSignal: AbortSignal | undefined;
        let resolveHost: ((outcome: RecipeCallOutcome) => void) | undefined;
        const context = execution(async (_capability, _input, call) => {
            hostSignal = call.signal;
            controller.abort();
            return new Promise((resolve) => {
                resolveHost = resolve;
            });
        });
        context.signal = controller.signal;
        const result = await executeRecipeProgram(
            program(readSource),
            null,
            context,
        );
        expect(result.status).toBe("cancelled");
        expect(hostSignal?.aborted).toBe(true);
        resolveHost?.({ status: "completed", value: "late" });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(result.output).toBeUndefined();
        expect(result.completedCallIds).toEqual([]);
    });

    it("cancels before dispatch and fails closed when checkpoint persistence fails", async () => {
        let calls = 0;
        const context = execution(async () => {
            calls++;
            return { status: "completed", value: "value" };
        });
        const artifact = program(readSource);
        const controller = new AbortController();
        controller.abort();
        expect(
            (
                await executeRecipeProgram(artifact, null, {
                    ...context,
                    signal: controller.signal,
                })
            ).status,
        ).toBe("cancelled");
        expect(
            (
                await executeRecipeProgram(artifact, null, context, {
                    onCheckpoint: async () => {
                        throw new Error("Disk failure");
                    },
                })
            ).status,
        ).toBe("failed");
        expect(calls).toBe(0);
    });

    it.each([
        ["CPU", `while (true) {} return "unreachable";`],
        [
            "memory",
            `const values: string[] = []; while (true) values.push("x".repeat(100000)); return "unreachable";`,
        ],
    ])("contains %s exhaustion", async (kind, body) => {
        const artifact = program(
            `async function execute(api, params) { ${body} }`,
        );
        const start = Date.now();
        const result = await executeRecipeProgram(artifact, null, execution(), {
            timeoutMs: kind === "memory" ? 1000 : 300,
            memoryLimitBytes: 2 * 1024 * 1024,
        });
        expect(result.status).not.toBe("completed");
        expect(Date.now() - start).toBeLessThan(3000);
    });

    it("contains stack overflow and leaves later runtimes usable", async () => {
        const artifact = program(`async function execute(api, params) {
            function recurse(): string { return recurse(); }
            return recurse();
        }`);
        expect(
            (
                await executeRecipeProgram(artifact, null, execution(), {
                    stackLimitBytes: 64 * 1024,
                })
            ).status,
        ).not.toBe("completed");
        const healthy = await executeRecipeProgram(
            program(
                `async function execute(api, params) { return "healthy"; }`,
            ),
            null,
            execution(),
        );
        expect(healthy.output).toBe("healthy");
    });

    it("provides no Node, filesystem, credentials or network globals even through constructors", async () => {
        const artifact = program(`async function execute(api, params) {
            const global = ({}).constructor.constructor("return this")();
            return ["process", "require", "fetch", "WebSocket", "XMLHttpRequest", "Deno", "Bun"]
                .map(name => typeof global[name]).join(",");
        }`);
        const result = await executeRecipeProgram(artifact, null, execution());
        expect(result.status).toBe("completed");
        expect(result.output).toBe(Array(7).fill("undefined").join(","));
    });

    it("bounds calls, pending promises and output", async () => {
        const many = program(`async function execute(api, params) {
            for (let i = 0; i < 10; i++) await api.tools.call("read", null);
            return "done";
        }`);
        expect(
            (
                await executeRecipeProgram(many, null, execution(), {
                    maxCalls: 2,
                })
            ).status,
        ).not.toBe("completed");
        const caughtLimit = program(`async function execute(api, params) {
            for (let i = 0; i < 10; i++) {
                try { await api.tools.call("read", null); } catch {}
            }
            return "ignored limits";
        }`);
        expect(
            (
                await executeRecipeProgram(caughtLimit, null, execution(), {
                    maxCalls: 2,
                })
            ).status,
        ).not.toBe("completed");
        const pending = program(
            `async function execute(api, params) { return new Promise<JsonValue>(() => {}); }`,
        );
        expect(
            (await executeRecipeProgram(pending, null, execution())).status,
        ).toBe("failed");
        const large = program(
            `async function execute(api, params) { return "x".repeat(10000); }`,
        );
        expect(
            (
                await executeRecipeProgram(large, null, execution(), {
                    maxJsonBytes: 1000,
                })
            ).status,
        ).toBe("failed");
    });

    it("rejects corruption and resealed executable/compiler forgery", async () => {
        const artifact = program(readSource);
        const { revision: _revision, ...content } = artifact;
        for (const corrupted of [
            { ...artifact, source: { ...artifact.source, text: "corrupt" } },
            {
                ...artifact,
                executable: { ...artifact.executable, text: "corrupt" },
            },
            sealRecipeArtifact({
                ...content,
                executable: {
                    ...artifact.executable,
                    compiler: {
                        ...artifact.executable.compiler,
                        version: "other",
                    },
                },
            }),
            sealRecipeArtifact({
                ...content,
                executable: {
                    ...artifact.executable,
                    text: 'async function execute(){return "forged"}',
                    digest: recipeDigest(
                        'async function execute(){return "forged"}',
                    ),
                },
            }),
        ]) {
            expect(
                (await executeRecipeProgram(corrupted, null, execution()))
                    .status,
            ).toBe("failed");
        }
    });

    it.each<RecipeSemanticOutcome>([
        { status: "abstained", reason: "Cannot decide" },
        { status: "invalid_output", message: "Invalid" },
        { status: "cancelled", message: "Stopped" },
    ])("preserves semantic stops: $status", async (outcome) => {
        const artifact = semanticProgram();
        const context = execution();
        context.host.invokeSemantic = async () => outcome;
        const result = await executeRecipeProgram(artifact, null, context);
        expect(result.status).toBe(
            outcome.status === "invalid_output" ? "failed" : outcome.status,
        );
    });

    it("validates semantic output and records evidence", async () => {
        const artifact = semanticProgram();
        const context = execution();
        context.host.invokeSemantic = async () => ({
            status: "completed",
            value: "selected",
            evidence: {
                functionId: "select",
                functionRevision: "1",
                resolvedModel: "actual",
                latencyMs: 1,
                validation: "passed",
                sourceIds: [],
            },
        });
        const result = await executeRecipeProgram(artifact, null, context);
        expect(result.output).toBe("selected");
        expect(result.semanticEvidence[0].resolvedModel).toBe("actual");
    });

    it("enforces semantic host deadlines even when the provider ignores cancellation", async () => {
        let hostSignal: AbortSignal | undefined;
        const context = execution();
        context.host.invokeSemantic = async (_definition, _input, call) => {
            hostSignal = call.signal;
            return new Promise(() => {});
        };
        const result = await executeRecipeProgram(
            semanticProgram(),
            null,
            context,
        );
        expect(result.status).toBe("limit_exceeded");
        expect(hostSignal?.aborted).toBe(true);
    });

    it("marks interrupted effects uncertain and awaits the uncertainty checkpoint", async () => {
        const controller = new AbortController();
        const context = execution(async () => {
            controller.abort();
            return new Promise(() => {});
        });
        context.signal = controller.signal;
        const phases: string[] = [];
        const artifact = program(readSource, {
            capabilities: [{ ...capability, effect: "write" }],
        });
        const result = await executeRecipeProgram(artifact, null, context, {
            onCheckpoint: async (checkpoint) => {
                phases.push(checkpoint.phase);
            },
        });
        expect(result.status).toBe("execution_uncertain");
        expect(result.checkpoints[0].phase).toBe("uncertain");
        expect(phases).toEqual(["not_dispatched", "dispatched", "uncertain"]);
    });

    it("stops queued parallel calls after host denial", async () => {
        let calls = 0;
        const artifact = program(`async function execute(api, params) {
            const first = api.tools.call("read", null);
            const second = api.tools.call("read", null);
            await first;
            return await second;
        }`);
        const result = await executeRecipeProgram(
            artifact,
            null,
            execution(async () => {
                calls++;
                return {
                    status: "denied",
                    code: "permission",
                    message: "Denied",
                };
            }),
        );
        expect(result.status).toBe("denied");
        expect(calls).toBe(1);
    });
});

function semanticProgram(): RecipeArtifact {
    return program(
        `async function execute(api, params) { return api.semantic.call("select", null); }`,
        {
            execution: "hybrid",
            semanticFunctions: [
                {
                    id: "select",
                    revision: "1",
                    inputSchema: { type: "null" },
                    outputSchema: { type: "string" },
                    specification: {
                        id: "spec",
                        revision: "1",
                        task: "Select",
                        rubric: "Exact",
                    },
                    modelPolicy: { id: "approved", revision: "1" },
                    bounds: {
                        timeoutMs: 100,
                        maxInputBytes: 1000,
                        maxOutputBytes: 1000,
                        maxCalls: 1,
                        maxRepairAttempts: 0,
                        maxConcurrency: 1,
                    },
                    evidence: { sourceIds: "none", quotations: false },
                },
            ],
        },
    );
}
