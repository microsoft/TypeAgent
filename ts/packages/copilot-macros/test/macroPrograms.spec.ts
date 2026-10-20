// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    MacroManager,
    type MacroLearningMode,
    type MacroLearningRuntime,
    type MacroProgramRuntime,
    type RecordedInteractionTrace,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { compileRecipeProgram } from "../src/recipeCompiler.js";
import { RecipeExecutor } from "../src/recipeExecutor.js";
import { recipeDigest, recipeSchemaDigest } from "../src/recipeCore.js";
import type { RecipeHost } from "../src/recipeContracts.js";
import { recipeArtifact } from "./recipeCatalogFixtures.js";
import { readProgramJournal } from "../src/macroProgramRun.js";
import { childCapture } from "./childLearningFixtures.js";

const cwd = "C:\\checkpoint-a";
let directory: string;
let executor: RecipeExecutor;

beforeEach(async () => {
    directory = await mkdtemp(path.resolve(".macro-programs-"));
    executor = new RecipeExecutor({ maxWorkers: 2 });
});

afterEach(async () => {
    await executor.close();
    await rm(directory, { recursive: true, force: true });
});

async function setup(mode: MacroLearningMode = "all", source?: string) {
    const manager = new MacroManager(directory, {
        inspectTool: async (_server, toolName) => ({
            toolName,
            mcpServerName: "docs",
            schemaFingerprint: "v1",
            readOnly: true,
        }),
        callTool: async () => {
            throw new Error(
                "Neither learning nor program execution uses replay.",
            );
        },
    });
    await manager.setMacroLearningPreference({ cwd, mode });
    const trace: RecordedInteractionTrace = {
        schemaVersion: 1,
        sessionId: "recorded",
        cwd,
        prompt: "Read alpha.txt",
        response: "Alpha contents",
        startedAt: "2026-10-15T20:00:00Z",
        completedAt: "2026-10-15T20:00:01Z",
        toolCalls: [
            {
                toolCallId: "call-1",
                name: "read",
                mcpServerName: "docs",
                arguments: { path: "alpha.txt" },
                result: { content: "Alpha contents" },
                status: "completed",
            },
        ],
    };
    manager.armRecording({ sessionId: trace.sessionId, learning: true, cwd });
    const token = manager.claimRecording({
        sessionId: trace.sessionId,
        cwd,
        promptHash: createHash("sha256").update(trace.prompt).digest("hex"),
    })!;
    const saved = await manager.finalizeRecording({
        tokenId: token.id,
        trace,
        childAuthoring: childCapture(trace, token.id),
    });
    const learner: MacroLearningRuntime = {
        withAuthorQuery(query) {
            expect(query).toEqual(expect.any(Function));
            return this;
        },
        extract: async (_trace, traceId) => ({
            schemaVersion: 1,
            traceId,
            request: trace.prompt,
            toolCallIds: ["call-1"],
            description: "Read file contents.",
            uncertainties: [],
        }),
        build: async (_recipe, _trace, baseline) => ({
            name: "Read file",
            description: "Read fresh contents.",
            inputs: baseline.inputs,
            steps: baseline.steps,
            exampleInputs: { step_1_path: "alpha.txt" },
            requests: [
                trace.prompt,
                "Show alpha.txt",
                "Display alpha.txt",
                "Inspect alpha.txt",
            ],
        }),
        generateGrammar: async () => ["fixture-grammar"],
        validateGrammar: () => {},
        buildProgram: async (macro) =>
            recipeArtifact(macro.macroId, macro.sourceTraceId, {
                ...(source
                    ? {
                          source: {
                              language: "typescript" as const,
                              text: source,
                              digest: recipeDigest(source),
                          },
                          executable: compileRecipeProgram(source),
                          capabilities: [
                              {
                                  id: "read",
                                  transport: "native" as const,
                                  providerId: "test",
                                  operation: "read",
                                  contractVersion: "1",
                                  inputSchema: { type: "null" as const },
                                  outputSchema: { type: "string" as const },
                                  schemaDigest: recipeSchemaDigest(
                                      { type: "null" },
                                      { type: "string" },
                                  ),
                                  compatibility: "exact" as const,
                                  effect: "read" as const,
                              },
                          ],
                      }
                    : {}),
                inputSchema: {
                    type: "object",
                    properties: { step_1_path: { type: "string" } },
                    required: ["step_1_path"],
                    additionalProperties: false,
                },
                matching: {
                    grammar: [
                        "<Start> = read $(step_1_path:string) -> { step_1_path };",
                    ],
                    examples: [
                        {
                            request: "read alpha.txt",
                            input: { step_1_path: "alpha.txt" },
                            evidenceIds: [
                                "recorded",
                                macro.learning!.authoring.contextDigest,
                            ],
                        },
                    ],
                    negatives: ["delete file"],
                    collisionEvidenceIds: [],
                },
                provenance: {
                    captureId: macro.learning!.authoring.captureId,
                    taskId: macro.learning!.authoring.taskId,
                    tokenId: macro.learning!.authoring.tokenId,
                    evidenceIds: [
                        "recorded",
                        macro.learning!.authoring.contextDigest,
                    ],
                    legacySource: {
                        macroId: macro.macroId,
                        version: macro.version,
                    },
                },
            }),
    };
    await manager.configureLearning(learner);
    let job = await manager.prepareMacroLearning({ traceId: saved.traceId });
    for (let attempt = 0; attempt < 500; attempt++) {
        job = await manager.getMacroLearningJob(job.jobId);
        if (!["queued", "extracting", "building"].includes(job.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!job.macro) throw new Error(`Learning failed: ${JSON.stringify(job)}`);
    return { manager, ref: job.macro, job };
}

function realRuntime(
    manager: MacroManager,
    invoke: RecipeHost["invokeCapability"],
) {
    manager.configureProgramRuntime({
        execute: (artifact, input, request) =>
            executor.execute(
                artifact,
                input,
                {
                    runId: request.runId,
                    signal: request.signal,
                    binding: {
                        workspaceId: "workspace",
                        profileId: "profile",
                        providerId: "test",
                        accountId: "account",
                        sessionId: "session",
                        generation: "1",
                    },
                    host: {
                        inspectCapability: async (capability) => ({
                            status: "available",
                            capability,
                        }),
                        invokeCapability: invoke,
                        invokeSemantic: async () => ({
                            status: "unsupported",
                            code: "test",
                            message: "No semantic calls",
                        }),
                    },
                },
                {
                    onCheckpoint: request.onCheckpoint,
                    timeoutMs: request.timeoutMs,
                },
            ),
    });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Expected concurrent progress")),
                    3_000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function journal(runId: string) {
    return readProgramJournal(path.join(directory, "copilot-macros"), runId);
}

function fakeRuntime(): MacroProgramRuntime {
    let calls = 0;
    return {
        async execute(artifact, input, context) {
            const checkpoint = {
                callId: "read",
                capabilityId: "read",
                effect: "read" as const,
                phase: "dispatched" as const,
            };
            await context.onCheckpoint(checkpoint);
            const saved = await journal(context.runId);
            expect(saved.checkpoints[0].phase).toBe("dispatched");
            calls++;
            const completed = { ...checkpoint, phase: "completed" as const };
            await context.onCheckpoint(completed);
            return {
                recipeId: artifact.recipeId,
                revision: artifact.revision,
                runId: context.runId,
                accepted: true,
                status: "completed",
                output: `${JSON.stringify(input)}:${calls}`,
                checkpoints: [completed],
                completedCallIds: ["read"],
                semanticEvidence: [],
                fallback: "never",
            };
        },
    };
}

describe("TypeAgent program macro integration", () => {
    it("surfaces persistent journal publication failures without inventing durable completion", async () => {
        const { manager, ref } = await setup(
            "all",
            `async function execute(api, params) {
            const first = await api.tools.call("read", null);
            return [first, await api.tools.call("read", null)].join("");
        }`,
        );
        const runId = "failed-publication";
        const destination = path.join(
            directory,
            "copilot-macros",
            "program-runs",
            `${runId}.json`,
        );
        const retained = `${destination}.retained`;
        let calls = 0;
        realRuntime(manager, async () => {
            calls++;
            await rename(destination, retained);
            await mkdir(destination);
            return { status: "completed", value: "fresh" };
        });
        try {
            expect(
                (
                    await manager.runMacro({
                        ...ref,
                        runId,
                        inputs: { step_1_path: "beta.txt" },
                    })
                ).status,
            ).toBe("failed");
            const record = await manager.getMacroRun(runId);
            expect(record.program?.completedCallIds).toEqual([]);
            expect(record.program?.checkpoints).toEqual([
                expect.objectContaining({ phase: "dispatched" }),
            ]);
            expect(calls).toBe(1);
            expect(
                (await readdir(path.dirname(destination))).filter((name) =>
                    name.endsWith(".tmp"),
                ),
            ).toEqual([]);
        } finally {
            await rmdir(destination);
            await rename(retained, destination);
            await manager.close();
        }
    });

    it("overlaps real read calls only after durable dispatch and preserves reply identities across restart", async () => {
        const { manager, ref } = await setup(
            "all",
            `async function execute(api, params) {
            return (await Promise.all([api.tools.call("read", null), api.tools.call("read", null)])).join("|");
        }`,
        );
        const entered = deferred();
        const secondFinished = deferred();
        const releases = [deferred(), deferred()];
        let calls = 0;
        realRuntime(manager, async (_capability, _input, call) => {
            const index = calls++;
            expect((await journal("parallel")).checkpoints).toContainEqual(
                expect.objectContaining({
                    callId: call.callId,
                    phase: "dispatched",
                }),
            );
            if (calls === 2) entered.resolve();
            await releases[index].promise;
            if (index === 1) secondFinished.resolve();
            return { status: "completed", value: `value-${index}` };
        });
        const run = manager.runMacro({
            ...ref,
            runId: "parallel",
            inputs: { step_1_path: "beta.txt" },
        });
        try {
            await within(
                Promise.race([
                    entered.promise,
                    run.then((response) => {
                        throw new Error(
                            `Run settled before overlap: ${JSON.stringify(response)}`,
                        );
                    }),
                ]),
            );
            releases[1].resolve();
            await within(secondFinished.promise);
            releases[0].resolve();
            expect((await run).status).toBe("completed");
            const persisted = await new MacroManager(directory).getMacroRun(
                "parallel",
            );
            expect(persisted.result).toBe("value-0|value-1");
            expect(persisted.program?.completedCallIds).toEqual([
                "parallel:2",
                "parallel:1",
            ]);
            expect((await journal("parallel")).checkpoints).toEqual([
                expect.objectContaining({
                    callId: "parallel:1",
                    phase: "completed",
                }),
                expect.objectContaining({
                    callId: "parallel:2",
                    phase: "completed",
                }),
            ]);
        } finally {
            releases.forEach((release) => release.resolve());
            await run;
            await manager.close();
        }
    });

    it.each(["denied", "cancelled", "disabled"] as const)(
        "stops unsent parallel reads after %s without accepting late outcomes",
        async (terminal) => {
            const { manager, ref } = await setup(
                "all",
                `async function execute(api, params) {
                return (await Promise.all(Array.from({length: 8}, () => api.tools.call("read", null)))).join("");
            }`,
            );
            const entered = deferred();
            const releases = Array.from({ length: 4 }, () => deferred());
            const signals: AbortSignal[] = [];
            realRuntime(manager, async (_capability, _input, call) => {
                const index = signals.length;
                signals.push(call.signal);
                if (signals.length === 4) entered.resolve();
                await releases[index].promise;
                if (terminal === "denied" && index === 0)
                    return {
                        status: "denied",
                        code: "permission",
                        message: "Denied",
                    };
                return { status: "completed", value: "fresh" };
            });
            const runId = `parallel-${terminal}`;
            const run = manager.runMacro({
                ...ref,
                runId,
                inputs: { step_1_path: "beta.txt" },
            });
            try {
                await within(entered.promise);
                if (terminal === "cancelled") manager.cancelMacroRun(runId);
                else {
                    if (terminal === "disabled")
                        await manager.disableMacro(ref);
                    releases[0].resolve();
                }
                const response = await within(run);
                expect(response.status).not.toBe("completed");
                expect(signals).toHaveLength(4);
                expect(signals.every((signal) => signal.aborted)).toBe(true);
                const persisted = await manager.getMacroRun(runId);
                expect(persisted.program?.completedCallIds).toEqual(
                    terminal === "disabled" ? [`${runId}:1`] : [],
                );
                const before = await journal(runId);
                releases.forEach((release) => release.resolve());
                await new Promise<void>((resolve) => setImmediate(resolve));
                expect(await journal(runId)).toEqual(before);
                expect(signals).toHaveLength(4);
            } finally {
                releases.forEach((release) => release.resolve());
                await run;
                await manager.close();
            }
        },
    );
    it("publishes under All and runs fresh inputs without a runner or replay consent", async () => {
        const { manager, ref, job } = await setup();
        expect(job.status).toBe("ready");
        expect(ref.state).toBe("approved");
        expect((await manager.inspectMacro(ref)).executionKind).toBe("program");
        manager.configureProgramRuntime(fakeRuntime());
        for (const [index, file] of ["beta.txt", "gamma.txt"].entries()) {
            const response = await manager.runMacro({
                ...ref,
                runId: `run-${index}`,
                inputs: { step_1_path: file },
            });
            expect(response.status).toBe("completed");
            if (response.status !== "completed")
                throw new Error("Program failed.");
            expect(response.run.program?.status).toBe("completed");
            expect(response.run.result).toBe(
                `{"step_1_path":"${file}"}:${index + 1}`,
            );
            expect(
                (await manager.getMacroRun(`run-${index}`)).program?.fallback,
            ).toBe("never");
        }
    });

    it("leaves Prepare non-runnable and never substitutes the legacy runner", async () => {
        const { manager, ref } = await setup("prepare");
        manager.configureProgramRuntime(fakeRuntime());
        expect(ref.state).toBe("draft");
        await expect(
            manager.runMacro({
                ...ref,
                runId: "prepared",
                inputs: { step_1_path: "beta.txt" },
            }),
        ).rejects.toThrow("Only approved macros");
    });

    it("preserves read-only publication without manual execution consent", async () => {
        const { manager, ref, job } = await setup("read-only");
        expect(job.status).toBe("ready");
        manager.configureProgramRuntime(fakeRuntime());
        expect(
            (
                await manager.runMacro({
                    ...ref,
                    runId: "read-only",
                    inputs: { step_1_path: "beta.txt" },
                })
            ).status,
        ).toBe("completed");
    });

    it("stops future calls after disable and retains completed-call evidence", async () => {
        const { manager, ref } = await setup();
        manager.configureProgramRuntime({
            async execute(_artifact, _input, context) {
                await context.onCheckpoint({
                    callId: "first",
                    capabilityId: "read",
                    effect: "read",
                    phase: "dispatched",
                });
                await context.onCheckpoint({
                    callId: "first",
                    capabilityId: "read",
                    effect: "read",
                    phase: "completed",
                });
                await manager.disableMacro(ref);
                await context.onCheckpoint({
                    callId: "second",
                    capabilityId: "read",
                    effect: "read",
                    phase: "dispatched",
                });
                throw new Error(
                    "Disabled program must not reach another call.",
                );
            },
        });
        const response = await manager.runMacro({
            ...ref,
            runId: "disable-in-flight",
            inputs: { step_1_path: "beta.txt" },
        });
        expect(response.status).toBe("failed");
        if (response.status !== "failed")
            throw new Error("Expected terminal failure.");
        expect(response.run.program?.completedCallIds).toEqual(["first"]);
        expect(response.run.program?.checkpoints).toHaveLength(1);
        expect(response.run.program?.message).toContain(
            "disabled or superseded",
        );
        expect(response.run.program?.fallback).toBe("never");
    });

    it("persists uncertain dispatch and never retries a lost reply", async () => {
        const { manager, ref } = await setup();
        manager.configureProgramRuntime({
            async execute(_artifact, _input, context) {
                await context.onCheckpoint({
                    callId: "lost",
                    capabilityId: "read",
                    effect: "read",
                    phase: "dispatched",
                });
                throw new Error("Reply lost.");
            },
        });
        const response = await manager.runMacro({
            ...ref,
            runId: "lost-reply",
            inputs: { step_1_path: "beta.txt" },
        });
        expect(response.status).toBe("failed");
        const restarted = new MacroManager(directory);
        expect(
            (await restarted.getMacroRun("lost-reply")).program,
        ).toMatchObject({
            status: "execution_uncertain",
            completedCallIds: [],
            fallback: "never",
            checkpoints: [{ callId: "lost", phase: "dispatched" }],
        });
    });

    it("rejects a missing runtime without falling back", async () => {
        const { manager, ref } = await setup();
        await expect(
            manager.runMacro({
                ...ref,
                runId: "missing",
                inputs: { step_1_path: "beta.txt" },
            }),
        ).rejects.toThrow("runtime is unavailable");
    });

    it("pins authoritative revisions and rejects duplicate run IDs", async () => {
        const { manager, ref } = await setup();
        manager.configureProgramRuntime(fakeRuntime());
        const request = {
            ...ref,
            runId: "once",
            inputs: { step_1_path: "beta.txt" },
        };
        expect((await manager.runMacro(request)).status).toBe("completed");
        await expect(manager.runMacro(request)).rejects.toMatchObject({
            code: "EEXIST",
        });
        await manager.disableMacro(ref);
        await expect(
            manager.runMacro({
                ...request,
                runId: "stale",
            }),
        ).rejects.toThrow();
    });

    it("persists program catalogs across restart, searches, disables and deletes them", async () => {
        const { manager, ref } = await setup();
        const restarted = new MacroManager(directory);
        expect(
            (await restarted.getApprovedMacros()).map((macro) => macro.macroId),
        ).toEqual([ref.macroId]);
        expect(
            await restarted.searchMacros({ query: "Read file" }),
        ).toMatchObject([
            { macro: { macroId: ref.macroId, state: "approved" } },
        ]);
        const before = await restarted.inspectMacro(ref);
        await restarted.disableMacro(ref);
        expect(await restarted.getApprovedMacros()).toEqual([]);
        expect(await restarted.inspectMacro(ref)).toEqual(before);
        await restarted.deleteMacro(ref);
        expect(await restarted.listMacros()).toEqual([]);
        expect(await new MacroManager(directory).listMacros()).toEqual([]);
        expect(await manager.listMacros()).toEqual([]);
    });

    it("cannot persist or publish a step-only definition", async () => {
        const { manager, ref } = await setup("prepare");
        const source = await manager.inspectMacro(ref);
        const stepOnly = { ...source };
        delete stepOnly.program;
        delete stepOnly.executionKind;
        await expect(manager.saveDraft(stepOnly)).rejects.toThrow(
            "Only validated program macros",
        );
        expect(await manager.inspectMacro(ref)).toEqual(source);
    });
});
