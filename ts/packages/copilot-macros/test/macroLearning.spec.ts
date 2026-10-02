// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    MacroManager,
    inspectReplayTools,
    type CopilotToolMacro,
    type MacroLearningBuild,
    type MacroLearningJob,
    type MacroLearningMode,
    type MacroLearningRuntime,
    type RecordedInteractionTrace,
    type ReplayToolHost,
    type EvidencedMacroCandidateRequest,
} from "@typeagent/copilot-macros";

const cwd = "C:\\learning-workspace";
const jest = (import.meta as ImportMeta & { jest: typeof globalThis.jest })
    .jest;
const directories: string[] = [];
const requestVariants = [
    "Show package.json",
    "Inspect package.json",
    "Display package.json",
];

afterEach(async () => {
    for (const directory of directories.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

async function setup(mode: MacroLearningMode = "prepare", readOnly?: boolean) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "macro-learning-"));
    directories.push(directory);
    const host: ReplayToolHost = {
        inspectTool: jest.fn(async (_server, toolName) => ({
            toolName,
            schemaFingerprint: "schema-1",
            ...(readOnly === undefined ? {} : { readOnly }),
        })),
        callTool: jest.fn(async () => {
            throw new Error("Learning must never execute task tools.");
        }),
    };
    const manager = new MacroManager(directory, host);
    await manager.setMacroLearningPreference({ cwd, mode });
    return { directory, manager, host };
}

function recordedTrace(sessionId: string): RecordedInteractionTrace {
    return {
        schemaVersion: 1,
        sessionId,
        cwd,
        prompt: "Read package.json",
        response: "The package is empty.",
        startedAt: "2026-09-30T10:00:00Z",
        completedAt: "2026-09-30T10:00:01Z",
        toolCalls: [
            {
                toolCallId: "call-1",
                name: "read",
                mcpServerName: "workspace",
                arguments: { path: "package.json" },
                result: { content: "{}" },
                status: "completed",
            },
        ],
    };
}

async function capture(
    manager: MacroManager,
    options: {
        learning?: boolean;
        trace?: RecordedInteractionTrace;
        sessionId?: string;
    } = {},
) {
    const trace =
        options.trace ?? recordedTrace(options.sessionId ?? "session-1");
    manager.armRecording({
        sessionId: trace.sessionId,
        ...(options.learning ? { learning: true, cwd } : {}),
    });
    const token = manager.claimRecording({
        sessionId: trace.sessionId,
        cwd: trace.cwd,
        promptHash: createHash("sha256").update(trace.prompt).digest("hex"),
    })!;
    return manager.finalizeRecording({ tokenId: token.id, trace });
}

function runtime(
    change?: (build: MacroLearningBuild) => void,
): MacroLearningRuntime {
    return {
        extract: jest.fn(async (trace, traceId) => ({
            schemaVersion: 1 as const,
            traceId,
            request: trace.prompt,
            toolCallIds: trace.toolCalls.map((call) => call.toolCallId),
            description: "Read package contents.",
            uncertainties: [],
        })),
        build: jest.fn(async (_recipe, trace, baseline) => {
            const build: MacroLearningBuild = {
                name: "Read package",
                description: "Read a requested package file.",
                inputs: baseline.inputs,
                steps: baseline.steps,
                exampleInputs: { step_1_path: "package.json" },
                requests: [trace.prompt, ...requestVariants],
                unsupportedOutputs: [],
            };
            change?.(build);
            return build;
        }),
        generateGrammar: jest.fn(async (macro) => [
            `version-${macro.version}-grammar`,
        ]),
        validateGrammar: jest.fn(),
    };
}

async function terminal(
    manager: MacroManager,
    jobId: string,
): Promise<MacroLearningJob> {
    for (let attempt = 0; attempt < 500; attempt++) {
        const job = await manager.getMacroLearningJob(jobId);
        if (!["queued", "extracting", "building"].includes(job.status))
            return job;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Learning job did not reach a terminal status.");
}

function adaptationRuntime(): MacroLearningRuntime {
    const learner = runtime();
    const build = learner.build;
    learner.build = jest.fn(async (...args) => {
        const value = await build(...args);
        value.exampleInputs.step_1_path = args[1].prompt.slice("Read ".length);
        return value;
    });
    return learner;
}

async function recordRunnerAdaptation(
    manager: MacroManager,
    source: CopilotToolMacro,
    learning = false,
    file = "other.json",
): Promise<EvidencedMacroCandidateRequest> {
    const handoffRunId = `verified-runner-adaptation-${file.replace(".", "-")}`;
    await manager.runMacro({
        macroId: source.macroId,
        version: source.version,
        runId: handoffRunId,
        inputs: { step_1_path: file },
        preference: "agent",
    });
    const trace = recordedTrace("runner-adaptation-session");
    trace.prompt = `Read ${file}`;
    trace.toolCalls[0].arguments = { path: file };
    trace.handoffRunId = handoffRunId;
    trace.startedAt = new Date().toISOString();
    trace.completedAt = new Date(Date.parse(trace.startedAt) + 1).toISOString();
    const summary = await capture(manager, { trace, learning });
    return {
        sourceMacroId: source.macroId,
        sourceVersion: source.version,
        handoffRunId,
        traceId: summary.traceId,
        reason: "Verified requested file adaptation",
        inputs: source.inputs,
        steps: source.steps,
        exampleInputs: { step_1_path: file },
        executionEvidence: {
            outcome: "completed",
            toolCalls: 1,
            retries: 0,
            durationMs: 1,
            tokensUsed: 0,
            steps: source.steps.map((step) => ({
                stepId: step.id,
                status: "completed",
            })),
        },
    };
}

describe("durable macro learning", () => {
    it("prepares a verified historical trace through the same coordinator after restart", async () => {
        const { manager, directory, host } = await setup("all");
        const historical = await capture(manager, {
            sessionId: "historical-session",
        });
        const restarted = new MacroManager(directory, host);
        const queued = await restarted.prepareMacroLearning({
            traceId: historical.traceId,
        });
        expect(queued.status).toBe("queued");
        const learner = runtime();
        await restarted.configureLearning(learner);
        const job = await terminal(restarted, queued.jobId);
        expect(job.status).toBe("ready");
        expect(learner.extract).toHaveBeenCalledTimes(1);
        expect(learner.build).toHaveBeenCalledTimes(1);
        expect(learner.generateGrammar).toHaveBeenCalledTimes(1);
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it("converges evidenced runner submissions on a new immutable version and grammar target", async () => {
        const { manager, host } = await setup("all");
        const learner = adaptationRuntime();
        await manager.configureLearning(learner);
        const original = await capture(manager, { learning: true });
        const originalJob = await terminal(manager, original.learningJobId!);
        const source = await manager.inspectMacro(originalJob.macro!);
        const submission = await recordRunnerAdaptation(manager, source);
        const queued = await manager.submitMacroCandidate(submission);
        const duplicate = await manager.submitMacroCandidate(submission);
        expect(duplicate.jobId).toBe(queued.jobId);
        const job = await terminal(manager, queued.jobId);
        expect(job.error).toBeUndefined();
        expect(job.macro).toEqual({
            macroId: source.macroId,
            version: 4,
            state: "approved",
        });
        const approved = await manager.inspectMacro(job.macro!);
        expect(approved.sourceTraceId).toBe(submission.traceId);
        expect(approved.candidateProvenance).toMatchObject({
            sourceMacroId: source.macroId,
            sourceVersion: 2,
            handoffRunId: submission.handoffRunId,
        });
        expect(approved.learning?.grammarRules).toEqual(["version-4-grammar"]);
        expect(learner.generateGrammar).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                macroId: source.macroId,
                version: 4,
                state: "approved",
            }),
            { step_1_path: "other.json" },
            expect.arrayContaining(["Read other.json"]),
            expect.any(AbortSignal),
        );
        expect(
            (await manager.getApprovedMacros()).map((macro) => macro.version),
        ).toEqual([4]);
        expect(
            (
                await manager.inspectMacro({
                    macroId: source.macroId,
                    version: 2,
                })
            ).sourceTraceId,
        ).toBe(original.traceId);
        await manager.disableMacro({ macroId: source.macroId });
        await expect(
            manager.runMacro({
                macroId: source.macroId,
                version: 2,
                runId: "old-version-suppressed",
                inputs: { step_1_path: "package.json" },
            }),
        ).rejects.toThrow("suppressed");
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it.each(["approve", "disable"] as const)(
        "shares a Prepare adaptation without removing the approved route before %s",
        async (operation) => {
            const { manager } = await setup("all");
            await manager.configureLearning(adaptationRuntime());
            const original = await capture(manager, { learning: true });
            const sourceJob = await terminal(manager, original.learningJobId!);
            const source = await manager.inspectMacro(sourceJob.macro!);
            await manager.setMacroLearningPreference({ cwd, mode: "prepare" });
            const submission = await recordRunnerAdaptation(
                manager,
                source,
                true,
            );
            const queued = await manager.submitMacroCandidate(submission);
            const historical = await manager.prepareMacroLearning({
                traceId: submission.traceId,
            });
            expect(historical.jobId).toBe(queued.jobId);
            const job = await terminal(manager, queued.jobId);
            expect(job.error).toBeUndefined();
            expect(job.status).toBe("needsReview");
            expect(job.macro?.version).toBe(3);
            expect(
                (await manager.getApprovedMacros()).map(
                    (macro) => macro.version,
                ),
            ).toEqual([2]);
            if (operation === "approve") {
                const approved = await manager.approveMacro(job.macro!);
                expect(approved.version).toBe(4);
                expect(
                    (await manager.inspectMacro(approved)).learning
                        ?.grammarRules,
                ).toEqual(["version-4-grammar"]);
            } else {
                const draft = await manager.inspectMacro(job.macro!);
                expect(
                    await manager.disableMacro({ macroId: source.macroId }),
                ).toMatchObject({
                    version: 4,
                    state: "disabled",
                });
                expect(await manager.inspectMacro(job.macro!)).toEqual(draft);
                expect(await manager.getApprovedMacros()).toEqual([]);
                expect(
                    (await manager.getMacroLearningJob(job.jobId)).status,
                ).toBe("cancelled");
            }
        },
    );

    it("disables above hidden adaptation versions and retains suppression after restart", async () => {
        const { manager, directory, host } = await setup("all");
        await manager.configureLearning(adaptationRuntime());
        const original = await capture(manager, { learning: true });
        const sourceJob = await terminal(manager, original.learningJobId!);
        const source = await manager.inspectMacro(sourceJob.macro!);
        await manager.setMacroLearningPreference({ cwd, mode: "prepare" });
        const first = await recordRunnerAdaptation(manager, source, true);
        const firstJob = await terminal(
            manager,
            (await manager.prepareMacroLearning({ traceId: first.traceId }))
                .jobId,
        );
        expect(firstJob.macro?.version).toBe(3);
        const second = await recordRunnerAdaptation(
            manager,
            source,
            true,
            "third.json",
        );
        const secondJob = await terminal(
            manager,
            (await manager.prepareMacroLearning({ traceId: second.traceId }))
                .jobId,
        );
        expect(secondJob.error).toBeUndefined();
        expect(secondJob.macro?.version).toBe(5);
        const drafts = await Promise.all(
            [firstJob, secondJob].map((job) =>
                manager.inspectMacro(job.macro!),
            ),
        );
        expect(drafts.map((draft) => draft.learning?.grammarRules)).toEqual([
            ["version-4-grammar"],
            ["version-6-grammar"],
        ]);
        expect(
            (await manager.getApprovedMacros()).map((macro) => macro.version),
        ).toEqual([2]);
        const disabled = await manager.disableMacro({
            macroId: source.macroId,
        });
        expect(disabled).toMatchObject({ version: 6, state: "disabled" });
        expect(await manager.inspectMacro(firstJob.macro!)).toEqual(drafts[0]);
        expect(await manager.inspectMacro(secondJob.macro!)).toEqual(drafts[1]);
        expect(await manager.getApprovedMacros()).toEqual([]);
        const restarted = new MacroManager(directory, host);
        await restarted.configureLearning(adaptationRuntime());
        expect(
            await restarted.inspectMacro({ macroId: source.macroId }),
        ).toMatchObject(disabled);
        expect(await restarted.getApprovedMacros()).toEqual([]);
        for (const job of [firstJob, secondJob]) {
            expect(
                (await restarted.getMacroLearningJob(job.jobId)).status,
            ).toBe("cancelled");
            await expect(restarted.approveMacro(job.macro!)).rejects.toThrow(
                "current draft",
            );
        }
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it.each([0, 1])(
        "approves pending adaptation %s at its reserved grammar version",
        async (selection) => {
            const { manager } = await setup("all");
            await manager.configureLearning(adaptationRuntime());
            const original = await capture(manager, { learning: true });
            const source = await manager.inspectMacro(
                (await terminal(manager, original.learningJobId!)).macro!,
            );
            await manager.setMacroLearningPreference({ cwd, mode: "prepare" });
            const first = await recordRunnerAdaptation(manager, source, true);
            const firstJob = await terminal(
                manager,
                (await manager.prepareMacroLearning({ traceId: first.traceId }))
                    .jobId,
            );
            const second = await recordRunnerAdaptation(
                manager,
                source,
                true,
                "third.json",
            );
            const secondJob = await terminal(
                manager,
                (
                    await manager.prepareMacroLearning({
                        traceId: second.traceId,
                    })
                ).jobId,
            );
            const jobs = [firstJob, secondJob];
            const approved = await manager.approveMacro(jobs[selection].macro!);
            expect(approved.version).toBe(selection === 0 ? 4 : 6);
            expect(
                (await manager.inspectMacro(approved)).learning?.grammarRules,
            ).toEqual([`version-${approved.version}-grammar`]);
            const superseded = jobs[1 - selection];
            await expect(
                manager.approveMacro(superseded.macro!),
            ).rejects.toThrow("current draft");
            if (selection === 0) {
                await expect(
                    manager.saveDraft(
                        await manager.inspectMacro(superseded.macro!),
                    ),
                ).rejects.toThrow("source version to remain approved");
            }
            expect(
                (await manager.getApprovedMacros()).map(
                    (macro) => macro.version,
                ),
            ).toEqual([approved.version]);
        },
    );

    it.each([
        "invented-input",
        "invented-tool",
        "wrong-handoff",
        "invalid-budget",
    ] as const)(
        "rejects %s adaptation evidence without another model call",
        async (invalid) => {
            const { manager } = await setup("all");
            const learner = adaptationRuntime();
            await manager.configureLearning(learner);
            const original = await capture(manager, { learning: true });
            const job = await terminal(manager, original.learningJobId!);
            const submission = await recordRunnerAdaptation(
                manager,
                await manager.inspectMacro(job.macro!),
            );
            if (invalid === "invented-input")
                submission.exampleInputs.step_1_path = "invented.json";
            if (invalid === "invented-tool")
                submission.steps[0].toolName = "write";
            if (invalid === "wrong-handoff")
                submission.handoffRunId = "another-handoff";
            if (invalid === "invalid-budget")
                submission.executionEvidence.tokensUsed =
                    Number.POSITIVE_INFINITY;
            await expect(
                manager.submitMacroCandidate(submission),
            ).rejects.toThrow();
            expect(learner.extract).toHaveBeenCalledTimes(1);
            expect(learner.build).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        [
            "missing exact original",
            [
                "read package.json",
                "Show package.json",
                "Inspect package.json",
                "Display package.json",
            ],
        ],
        [
            "too few variants",
            ["Read package.json", "Show package.json", "Inspect package.json"],
        ],
        [
            "duplicate variants",
            [
                "Read package.json",
                " read   PACKAGE.JSON ",
                "Inspect package.json",
                "Display package.json",
            ],
        ],
    ])(
        "rejects build requests with %s before grammar generation",
        async (_description, requests) => {
            const { manager } = await setup("all");
            const learner = runtime((build) => {
                build.requests = requests;
            });
            await manager.configureLearning(learner);
            const summary = await capture(manager, { learning: true });
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.status).toBe("failed");
            expect(learner.generateGrammar).not.toHaveBeenCalled();
            expect(await manager.getApprovedMacros()).toEqual([]);
        },
    );

    it("defaults off and leaves manual recording unchanged", async () => {
        const { manager } = await setup("off");
        await expect(
            manager.getMacroLearningPreference("C:\\other"),
        ).resolves.toMatchObject({
            mode: "off",
            revision: 0,
        });
        expect(() =>
            manager.armRecording({
                sessionId: "selected",
                learning: true,
                cwd,
            }),
        ).toThrow("Learning is off");
        const summary = await capture(manager);
        expect(summary.learningJobId).toBeUndefined();
        await expect(
            manager.prepareMacroLearning({ traceId: summary.traceId }),
        ).rejects.toThrow("Learning is off");
    });

    it("queues without a runtime, resumes after restart, and stages grammar for explicit v2 approval", async () => {
        const { manager, directory, host } = await setup();
        const summary = await capture(manager, { learning: true });
        const jobId = summary.learningJobId!;
        await expect(manager.getMacroLearningJob(jobId)).resolves.toMatchObject(
            { status: "queued" },
        );
        const restarted = new MacroManager(directory, host);
        const learner = runtime();
        await restarted.configureLearning(learner);
        const job = await terminal(restarted, jobId);
        expect(job.error).toBeUndefined();
        expect(job).toMatchObject({ status: "needsReview" });
        const draft = await restarted.inspectMacro(job.macro!);
        expect(draft.learning).toMatchObject({
            requiresLivePermissions: true,
            grammarRules: ["version-2-grammar"],
            mode: "prepare",
        });
        expect(learner.generateGrammar).toHaveBeenCalledWith(
            expect.objectContaining({ version: 2, state: "approved" }),
            { step_1_path: "package.json" },
            ["Read package.json", ...requestVariants],
            expect.any(AbortSignal),
        );
        const approved = await restarted.approveMacro(job.macro!);
        expect(approved.version).toBe(2);
        expect(
            (
                await restarted.inspectMacro({
                    macroId: approved.macroId,
                    version: 1,
                })
            ).state,
        ).toBe("draft");
        expect(
            (await restarted.getApprovedMacros())[0].learning?.grammarRules,
        ).toEqual(["version-2-grammar"]);
        expect((await restarted.getMacroLearningJob(jobId)).status).toBe(
            "ready",
        );
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        "grounds MCP-only learning in model results (dependency=%s)",
        async (dependency) => {
            const { manager, host } = await setup();
            const trace = recordedTrace("model-results");
            trace.toolCalls[0].modelResult = dependency
                ? { item: { id: "item-123" } }
                : {};
            if (dependency) {
                trace.toolCalls[0].result = {
                    content: '{"item":{"id":"item-123"}}',
                    transportId: "item-123",
                };
                trace.toolCalls.push({
                    toolCallId: "call-2",
                    name: "inspect",
                    mcpServerName: "workspace",
                    arguments: { id: "item-123" },
                    result: { content: '{"ok":true}' },
                    modelResult: { ok: true },
                    status: "completed",
                });
            }
            await manager.configureLearning(runtime());
            const summary = await capture(manager, { trace, learning: true });
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.error).toBeUndefined();
            expect(job.status).toBe("needsReview");
            const macro = await manager.inspectMacro(job.macro!);
            expect(macro.executionClass).toBe("replayable");
            expect(macro.steps[0].postconditions).toEqual([
                { kind: "resultType", valueType: "object" },
                ...(dependency
                    ? [{ kind: "resultPathExists", path: ["item", "id"] }]
                    : []),
            ]);
            if (dependency) {
                expect(macro.steps[1].arguments).toMatchObject({
                    kind: "template",
                    bindings: [
                        {
                            path: ["id"],
                            expression: {
                                kind: "stepResult",
                                stepId: "step-1",
                                path: ["item", "id"],
                            },
                        },
                    ],
                });
            }
            const replay = await manager.inspectMacro(
                await manager.createMacroFromTrace({
                    traceId: summary.traceId,
                    name: "Replay control",
                    description: "Raw replay result",
                }),
            );
            expect(replay.steps[0].postconditions).toContainEqual({
                kind: "resultPathExists",
                path: ["content"],
            });
            expect(host.callTool).not.toHaveBeenCalled();
        },
    );

    it("revalidates automatic approval without repeating generation", async () => {
        const { manager, host } = await setup("all");
        const learner = runtime();
        learner.validateGrammar = jest.fn(() => {
            throw new Error(
                "Macro grammar conflicts with the approved catalog",
            );
        });
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        expect(job.status).toBe("failed");
        expect(job.error).toContain("conflicts with the approved catalog");
        expect(await manager.getApprovedMacros()).toEqual([]);
        expect(learner.generateGrammar).toHaveBeenCalledTimes(1);
        expect(learner.validateGrammar).toHaveBeenCalledTimes(1);
        expect(host.callTool).not.toHaveBeenCalled();
        expect(
            (await manager.getRecordingState("session-1")).learningJob,
        ).toEqual(job);
    });

    it("uses the handoff flag rather than the replay flag for learned replayable macros", async () => {
        const { manager, host } = await setup("all");
        await manager.configureLearning(runtime());
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        const previous = process.env.TYPEAGENT_MACRO_REPLAY_ENABLED;
        process.env.TYPEAGENT_MACRO_REPLAY_ENABLED = "false";
        try {
            await expect(
                manager.runMacro({
                    macroId: job.macro!.macroId,
                    runId: "replay-disabled-live-handoff",
                    preference: "auto",
                    inputs: { step_1_path: "other.json" },
                }),
            ).resolves.toMatchObject({
                status: "agentRequired",
                launch: {
                    reason: {
                        code: "agentRequired",
                        message: expect.stringContaining("live runner"),
                    },
                },
            });
        } finally {
            if (previous === undefined)
                delete process.env.TYPEAGENT_MACRO_REPLAY_ENABLED;
            else process.env.TYPEAGENT_MACRO_REPLAY_ENABLED = previous;
        }
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it.each([
        ["read-only", true, "ready"],
        ["read-only", false, "needsReview"],
        ["read-only", undefined, "needsReview"],
        ["all", false, "ready"],
        ["prepare", true, "needsReview"],
    ] as const)(
        "enforces %s with readOnly=%s",
        async (mode, readOnly, status) => {
            const { manager, host } = await setup(mode, readOnly);
            await manager.configureLearning(runtime());
            const summary = await capture(manager, { learning: true });
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.status).toBe(status);
            expect(host.callTool).not.toHaveBeenCalled();
        },
    );

    it("allows native procedures in All but does not classify them read-only", async () => {
        for (const mode of ["all", "read-only"] as const) {
            const { manager, host } = await setup(mode, true);
            const trace = recordedTrace(`native-${mode}`);
            delete trace.toolCalls[0].mcpServerName;
            const learner = runtime();
            await manager.configureLearning(learner);
            const summary = await capture(manager, { trace, learning: true });
            expect(
                (await terminal(manager, summary.learningJobId!)).status,
            ).toBe(mode === "all" ? "ready" : "needsReview");
            expect(host.callTool).not.toHaveBeenCalled();
        }
    });

    it("centrally rejects forced replay and uses live handoff even for replayable learned macros", async () => {
        const { manager, host } = await setup("all");
        await manager.configureLearning(runtime());
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        const macro = await manager.inspectMacro(job.macro!);
        expect(macro.executionClass).toBe("replayable");
        await expect(
            inspectReplayTools(
                macro,
                host,
                { cwd },
                { step_1_path: "other.json" },
            ),
        ).rejects.toMatchObject({ code: "agentRequired" });
        const { learning: _learning, ...unmarked } = macro;
        await expect(
            manager.saveDraft({ ...unmarked, version: 3, state: "draft" }),
        ).rejects.toThrow("fresh grounded build");
        await expect(
            manager.runMacro({
                macroId: macro.macroId,
                runId: "forced-replay",
                inputs: { step_1_path: "other.json" },
                preference: "replay",
            }),
        ).rejects.toThrow("agent-guided");
        await expect(
            manager.runMacro({
                macroId: macro.macroId,
                runId: "auto-live",
                inputs: { step_1_path: "other.json" },
            }),
        ).resolves.toMatchObject({
            status: "agentRequired",
            launch: {
                macro: { learning: { requiresLivePermissions: true } },
            },
        });
        const oldFlag = process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED;
        process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED = "false";
        try {
            await expect(
                manager.runMacro({
                    macroId: macro.macroId,
                    runId: "disabled-handoff",
                    inputs: { step_1_path: "other.json" },
                }),
            ).rejects.toThrow("handoff is disabled");
        } finally {
            if (oldFlag === undefined)
                delete process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED;
            else process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED = oldFlag;
        }
        await manager.setMacroLearningPreference({ cwd, mode: "off" });
        await expect(
            manager.runMacro({
                macroId: macro.macroId,
                runId: "off-retains-approved-macro",
                inputs: { step_1_path: "other.json" },
            }),
        ).resolves.toMatchObject({ status: "agentRequired" });
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it.each(["failed", "denied"] as const)(
        "does not expose %s source traces to a model",
        async (status) => {
            const { manager } = await setup("all");
            const learner = runtime();
            await manager.configureLearning(learner);
            const trace = recordedTrace("bad-source");
            trace.toolCalls[0].status = status;
            const summary = await capture(manager, { trace, learning: true });
            expect(
                (await terminal(manager, summary.learningJobId!)).status,
            ).toBe("failed");
            expect(learner.extract).not.toHaveBeenCalled();
        },
    );

    it("does not expose redacted sources to a model", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        await manager.configureLearning(learner);
        const trace = recordedTrace("secret-source");
        trace.toolCalls[0].arguments = {
            path: "package.json",
            token: "sensitive",
        };
        const summary = await capture(manager, { trace, learning: true });
        expect(
            (await terminal(manager, summary.learningJobId!)).error,
        ).toContain("Secret-bearing");
        expect(learner.extract).not.toHaveBeenCalled();
    });

    it.each([
        [
            "invented input",
            (build: MacroLearningBuild) => {
                build.exampleInputs.step_1_path = "invented.json";
            },
        ],
        [
            "invented source",
            (build: MacroLearningBuild) => {
                build.steps[0].sourceToolCallId = "invented";
            },
        ],
        [
            "invented tool",
            (build: MacroLearningBuild) => {
                build.steps[0].toolName = "write";
            },
        ],
        [
            "unsupported synthesis",
            (build: MacroLearningBuild) => {
                build.unsupportedOutputs = ["Summarize all unseen files"];
            },
        ],
        [
            "unsupported expression",
            (build: MacroLearningBuild) => {
                build.steps[0].arguments = JSON.parse(
                    '{"kind":"script","value":"execute"}',
                ) as CopilotToolMacro["steps"][number]["arguments"];
            },
        ],
        [
            "invented result guard",
            (build: MacroLearningBuild) => {
                build.steps[0].postconditions = [
                    { kind: "resultPathExists", path: ["invented"] },
                ];
            },
        ],
        [
            "unused parameter",
            (build: MacroLearningBuild) => {
                build.inputs.push({
                    name: "unused",
                    description: "",
                    required: true,
                    secret: false,
                    valueType: "string",
                });
                build.exampleInputs.unused = "invented";
            },
        ],
    ])("persists validation failure for %s", async (_description, change) => {
        const { manager } = await setup("all");
        const learner = runtime(change);
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        expect(job.status).toBe("failed");
        expect(job.error).toBeTruthy();
        expect(learner.generateGrammar).not.toHaveBeenCalled();
        expect(await manager.getApprovedMacros()).toEqual([]);
    });

    it("rejects invalid factual recipe provenance before building", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        learner.extract = jest.fn(async (_trace, traceId) => ({
            schemaVersion: 1 as const,
            traceId,
            request: "Invented goal",
            description: "Wrong",
            toolCallIds: ["invented"],
            uncertainties: [],
        }));
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        expect((await terminal(manager, summary.learningJobId!)).status).toBe(
            "failed",
        );
        expect(learner.build).not.toHaveBeenCalled();
    });

    it("deduplicates simultaneous submissions and equivalent traces before model work", async () => {
        const { manager } = await setup();
        const first = await capture(manager);
        const jobs = await Promise.all(
            Array.from({ length: 8 }, () =>
                manager.prepareMacroLearning({ traceId: first.traceId }),
            ),
        );
        expect(new Set(jobs.map((job) => job.jobId)).size).toBe(1);
        const second = await capture(manager, { sessionId: "other-session" });
        const equivalent = await manager.prepareMacroLearning({
            traceId: second.traceId,
        });
        expect(equivalent.jobId).toBe(jobs[0].jobId);
        const learner = runtime();
        await manager.configureLearning(learner);
        await terminal(manager, jobs[0].jobId);
        expect(learner.extract).toHaveBeenCalledTimes(1);
    });

    it.each(["disable", "forget"] as const)(
        "suppresses %s equivalents durably without resurrecting versions",
        async (operation) => {
            const { manager, directory, host } = await setup("all");
            await manager.configureLearning(runtime());
            const first = await capture(manager, { learning: true });
            const job = await terminal(manager, first.learningJobId!);
            if (operation === "disable")
                await manager.disableMacro({ macroId: job.macro!.macroId });
            else await manager.deleteMacro({ macroId: job.macro!.macroId });
            await expect(
                manager.runMacro({
                    macroId: job.macro!.macroId,
                    version: 2,
                    runId: `suppressed-${operation}`,
                    inputs: { step_1_path: "package.json" },
                }),
            ).rejects.toThrow("suppressed");
            const restarted = new MacroManager(directory, host);
            const learner = runtime();
            await restarted.configureLearning(learner);
            const trace = recordedTrace("equivalent");
            trace.toolCalls[0].result = {
                content: "changed result does not undo suppression",
            };
            const second = await capture(restarted, { trace, learning: true });
            expect(second.learningJobId).toBe(job.jobId);
            expect(
                (await restarted.getMacroLearningJob(job.jobId)).status,
            ).toBe("cancelled");
            expect(learner.extract).not.toHaveBeenCalled();
            expect(await restarted.getApprovedMacros()).toEqual([]);
        },
    );

    it("cancels active work and ignores late runtime completion", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        let release!: () => void;
        let started!: () => void;
        const extracting = new Promise<void>((resolve) => {
            started = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const extract = learner.extract;
        learner.extract = jest.fn(async (...args) => {
            started();
            await blocked;
            return extract(...args);
        });
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        await extracting;
        await manager.cancelMacroLearningJob(summary.learningJobId!);
        release();
        expect((await terminal(manager, summary.learningJobId!)).status).toBe(
            "cancelled",
        );
        expect(learner.build).not.toHaveBeenCalled();
        expect(await manager.getApprovedMacros()).toEqual([]);
    });

    it("rechecks changed preferences before auto approval", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        const generate = learner.generateGrammar;
        learner.generateGrammar = jest.fn(async (...args) => {
            await manager.setMacroLearningPreference({ cwd, mode: "prepare" });
            return generate(...args);
        });
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        expect((await terminal(manager, summary.learningJobId!)).status).toBe(
            "needsReview",
        );
        expect(await manager.getApprovedMacros()).toEqual([]);
    });

    it("turning Off cancels in-flight learning and selected finalization records cancellation", async () => {
        const { manager } = await setup("all");
        const summary = await capture(manager, { learning: true });
        await manager.setMacroLearningPreference({ cwd, mode: "off" });
        expect(
            (await manager.getMacroLearningJob(summary.learningJobId!)).status,
        ).toBe("cancelled");
        await manager.setMacroLearningPreference({ cwd, mode: "all" });
        const trace = recordedTrace("changed-during-recording");
        trace.prompt = "Read a different package.json";
        manager.armRecording({
            sessionId: trace.sessionId,
            cwd,
            learning: true,
        });
        const token = manager.claimRecording({
            sessionId: trace.sessionId,
            cwd,
            promptHash: createHash("sha256").update(trace.prompt).digest("hex"),
        })!;
        await manager.setMacroLearningPreference({ cwd, mode: "off" });
        const finalized = await manager.finalizeRecording({
            tokenId: token.id,
            trace,
        });
        expect(
            (await manager.getMacroLearningJob(finalized.learningJobId!))
                .status,
        ).toBe("cancelled");
    });

    it("recovers interrupted stages within a persisted attempt budget", async () => {
        const { manager, directory, host } = await setup("all");
        const summary = await capture(manager, { learning: true });
        const file = path.join(directory, "copilot-macros", "learning.json");
        const state = JSON.parse(await readFile(file, "utf8")) as {
            jobs: Array<{ status: string; attempts: { extract: number } }>;
        };
        state.jobs[0].status = "extracting";
        state.jobs[0].attempts = { extract: 1 };
        await writeFile(file, JSON.stringify(state));
        const restarted = new MacroManager(directory, host);
        await restarted.configureLearning(runtime());
        expect((await terminal(restarted, summary.learningJobId!)).status).toBe(
            "ready",
        );
    });

    it("reports saved-but-refresh failure and resumes publication without repeating model work", async () => {
        const { manager, directory, host } = await setup("all");
        const learner = runtime();
        await manager.configureLearning(learner);
        let refreshes = 0;
        manager.onCatalogChanged(async () => {
            if (++refreshes === 2) throw new Error("Refresh unavailable");
        });
        const summary = await capture(manager, { learning: true });
        const failed = await terminal(manager, summary.learningJobId!);
        expect(failed.status).toBe("failed");
        expect(failed.error).toContain("catalog was saved");
        expect((await manager.getApprovedMacros())[0].version).toBe(2);
        const restarted = new MacroManager(directory, host);
        const restartedRuntime = runtime();
        await restarted.configureLearning(restartedRuntime);
        expect((await terminal(restarted, failed.jobId)).status).toBe("ready");
        expect(restartedRuntime.extract).not.toHaveBeenCalled();
        expect(restartedRuntime.generateGrammar).not.toHaveBeenCalled();
    });

    it("checks exact model-facing result dependencies without rerunning source tools", async () => {
        const { manager, host } = await setup("all", true);
        const trace = recordedTrace("result-dependencies");
        trace.toolCalls[0].result = { uiOnly: "not visible to the runner" };
        trace.toolCalls[0].modelResult = { content: "{}" };
        trace.toolCalls.push({
            toolCallId: "call-2",
            name: "consume",
            mcpServerName: "workspace",
            arguments: { content: "{}" },
            result: { ok: true },
            status: "completed",
        });
        const learner = runtime((build) => {
            build.steps[0].postconditions = [
                { kind: "resultType", valueType: "object" },
                { kind: "resultPathExists", path: ["content"] },
            ];
            build.steps[1].arguments = {
                kind: "template",
                value: { content: "{}" },
                bindings: [
                    {
                        path: ["content"],
                        expression: {
                            kind: "stepResult",
                            stepId: build.steps[0].id,
                            path: ["content"],
                        },
                    },
                ],
            };
        });
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true, trace });
        const job = await terminal(manager, summary.learningJobId!);
        expect(job.error).toBeUndefined();
        expect(job.status).toBe("ready");
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it("bounds model work at the exact 30-second deadline and persists timeout failure", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        let extractionStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            extractionStarted = resolve;
        });
        const extract = jest.fn(async () => {
            extractionStarted();
            return new Promise<never>(() => {});
        });
        learner.extract = extract;
        jest.useFakeTimers({ doNotFake: ["setImmediate"] });
        try {
            await manager.configureLearning(learner);
            const summary = await capture(manager, { learning: true });
            await started;
            expect(learner.extract).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(29_999);
            expect(
                (await manager.getMacroLearningJob(summary.learningJobId!))
                    .status,
            ).toBe("extracting");
            await jest.advanceTimersByTimeAsync(1);
            jest.useRealTimers();
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.status).toBe("failed");
            expect(job.error).toContain("30s deadline");
            expect(learner.build).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("rejects over-budget and incomplete evidence before exposing it to extraction", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        await manager.configureLearning(learner);
        const trace = recordedTrace("bounded-evidence");
        trace.toolCalls = Array.from({ length: 101 }, (_, index) => ({
            ...trace.toolCalls[0],
            toolCallId: `call-${index}`,
        }));
        const summary = await capture(manager, { learning: true, trace });
        expect((await terminal(manager, summary.learningJobId!)).status).toBe(
            "failed",
        );
        trace.sessionId = "incomplete-response";
        trace.toolCalls = [trace.toolCalls[0]];
        trace.response = "";
        const incomplete = await capture(manager, { learning: true, trace });
        expect(
            (await terminal(manager, incomplete.learningJobId!)).status,
        ).toBe("failed");
        expect(learner.extract).not.toHaveBeenCalled();
    });

    it("does not let an unsuccessful observation suppress later successful evidence", async () => {
        const { manager } = await setup("all");
        const trace = recordedTrace("failed-observation");
        trace.toolCalls[0].status = "failed";
        const failed = await capture(manager, { learning: true, trace });
        await manager.configureLearning(runtime());
        const succeeded = await capture(manager, {
            learning: true,
            sessionId: "successful-observation",
        });
        expect(succeeded.learningJobId).not.toBe(failed.learningJobId);
        expect((await terminal(manager, succeeded.learningJobId!)).status).toBe(
            "ready",
        );
    });

    it.each([false, true])(
        "revalidates interrupted approval recovery (conflict=%s) without repeating model work",
        async (conflict) => {
            const { manager, host, directory } = await setup("all");
            await manager.configureLearning(runtime());
            const summary = await capture(manager, { learning: true });
            const job = await terminal(manager, summary.learningJobId!);
            const stateFile = path.join(
                directory,
                "copilot-macros",
                "learning.json",
            );
            const state = JSON.parse(await readFile(stateFile, "utf8")) as {
                jobs: Array<{ status: string }>;
            };
            state.jobs[0].status = "building";
            await writeFile(stateFile, JSON.stringify(state));
            await writeFile(
                path.join(directory, "copilot-macros", "index.json"),
                "[]",
            );
            const restarted = new MacroManager(directory, host);
            const learner = runtime();
            if (conflict) {
                learner.validateGrammar = jest.fn(() => {
                    throw new Error(
                        "Macro grammar conflicts with the approved catalog",
                    );
                });
            }
            await restarted.configureLearning(learner);
            const recovered = await terminal(restarted, job.jobId);
            if (conflict) {
                expect(recovered.error).toContain(
                    "conflicts with the approved catalog",
                );
                expect(recovered.status).toBe("failed");
                expect(await restarted.getApprovedMacros()).toEqual([]);
            } else {
                expect(recovered.error).toBeUndefined();
                expect(recovered.status).toBe("ready");
                expect((await restarted.getApprovedMacros())[0].version).toBe(
                    2,
                );
            }
            expect(learner.extract).not.toHaveBeenCalled();
            expect(learner.build).not.toHaveBeenCalled();
            expect(learner.generateGrammar).not.toHaveBeenCalled();
            expect(learner.validateGrammar).toHaveBeenCalledWith(
                expect.objectContaining({ version: 2, state: "approved" }),
                [],
            );
        },
    );

    it("never exceeds the persisted per-stage restart budget", async () => {
        const { manager, host, directory } = await setup("all");
        const summary = await capture(manager, { learning: true });
        const stateFile = path.join(
            directory,
            "copilot-macros",
            "learning.json",
        );
        const state = JSON.parse(await readFile(stateFile, "utf8")) as {
            jobs: Array<{ status: string; attempts: { extract: number } }>;
        };
        state.jobs[0].status = "extracting";
        state.jobs[0].attempts = { extract: 2 };
        await writeFile(stateFile, JSON.stringify(state));
        const restarted = new MacroManager(directory, host);
        const learner = runtime();
        await restarted.configureLearning(learner);
        const job = await terminal(restarted, summary.learningJobId!);
        expect(job.status).toBe("failed");
        expect(job.error).toContain("restart budget");
        expect(learner.extract).not.toHaveBeenCalled();
    });

    it("bounds catalog refresh at the exact 10-second deadline", async () => {
        const { manager } = await setup("all");
        let started!: () => void;
        const refreshing = new Promise<void>((resolve) => {
            started = resolve;
        });
        manager.onCatalogChanged(async () => {
            started();
            return new Promise<never>(() => {});
        });
        jest.useFakeTimers({ doNotFake: ["setImmediate"] });
        try {
            await manager.configureLearning(runtime());
            const summary = await capture(manager, { learning: true });
            await refreshing;
            await jest.advanceTimersByTimeAsync(9_999);
            expect(
                (await manager.getMacroLearningJob(summary.learningJobId!))
                    .status,
            ).toBe("building");
            await jest.advanceTimersByTimeAsync(1);
            jest.useRealTimers();
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.status).toBe("failed");
            expect(job.error).toContain("catalog was saved");
            expect(job.error).toContain("10s deadline");
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not mark a concurrently disabled macro ready after delayed approval refresh", async () => {
        const { manager } = await setup("prepare");
        await manager.configureLearning(runtime());
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        let started!: () => void;
        let release!: () => void;
        const refreshing = new Promise<void>((resolve) => {
            started = resolve;
        });
        const delayed = new Promise<void>((resolve) => {
            release = resolve;
        });
        let notifications = 0;
        manager.onCatalogChanged(async () => {
            if (++notifications === 1) {
                started();
                await delayed;
            }
        });
        const approving = manager.approveMacro(job.macro!);
        await refreshing;
        await manager.disableMacro({ macroId: job.macro!.macroId });
        release();
        await approving;
        expect((await manager.getMacroLearningJob(job.jobId)).status).toBe(
            "cancelled",
        );
        expect(await manager.getApprovedMacros()).toEqual([]);
    });

    it.each([false, true])(
        "preserves exact null argument/result evidence (invented=%s)",
        async (invented) => {
            const { manager } = await setup("all");
            const trace = recordedTrace("null-evidence");
            trace.toolCalls[0].arguments = null;
            trace.toolCalls[0].modelResult = null;
            const learner = runtime((build) => {
                build.exampleInputs = {};
                build.steps[0].arguments = {
                    kind: "literal",
                    value: invented ? {} : null,
                };
                build.steps[0].postconditions = [
                    { kind: "resultType", valueType: "null" },
                ];
            });
            await manager.configureLearning(learner);
            const summary = await capture(manager, { learning: true, trace });
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.status).toBe(invented ? "failed" : "ready");
            if (invented)
                expect(job.error).toContain("exact recorded arguments");
        },
    );

    it.each([
        "TYPEAGENT_MACRO_RECORDING_ENABLED",
        "TYPEAGENT_MACRO_INDUCTION_ENABLED",
        "TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED",
    ])(
        "gates selected learning on %s without changing legacy arming",
        async (flag) => {
            const { manager } = await setup("all");
            const oldValue = process.env[flag];
            process.env[flag] = "false";
            try {
                expect(() =>
                    manager.armRecording({
                        sessionId: "selected",
                        cwd,
                        learning: true,
                    }),
                ).toThrow("must be enabled");
                expect(
                    manager.armRecording({ sessionId: "manual" }).status,
                ).toBe("armed");
            } finally {
                if (oldValue === undefined) delete process.env[flag];
                else process.env[flag] = oldValue;
            }
        },
    );
});
