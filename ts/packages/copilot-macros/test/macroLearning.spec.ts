// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    MacroManager,
    type CopilotToolMacro,
    type MacroLearningBuild,
    type MacroLearningJob,
    type MacroLearningMode,
    type MacroLearningRuntime,
    type RecordedInteractionTrace,
    type ReplayToolHost,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { macroProgramArtifact } from "./recipeCatalogFixtures.js";
import { childCapture } from "./childLearningFixtures.js";
import { sealRecipeArtifact } from "../src/recipeCore.js";

const cwd = "C:\\learning-workspace";
const jest = (import.meta as ImportMeta & { jest: typeof globalThis.jest })
    .jest;
const directories: string[] = [];
const managers: MacroManager[] = [];
const requestVariants = [
    "Show package.json",
    "Inspect package.json",
    "Display package.json",
];

afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.close()));
    for (const directory of directories.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

function createManager(...args: ConstructorParameters<typeof MacroManager>) {
    const manager = new MacroManager(...args);
    managers.push(manager);
    return manager;
}

async function setup(mode: MacroLearningMode = "prepare", readOnly?: boolean) {
    const directory = await mkdtemp(path.resolve(".macro-learning-"));
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
    const manager = createManager(directory, host);
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
    return manager.finalizeRecording({
        tokenId: token.id,
        trace,
        ...(options.learning
            ? { childAuthoring: childCapture(trace, token.id) }
            : {}),
    });
}

function runtime(
    change?: (build: MacroLearningBuild) => void,
): MacroLearningRuntime {
    return {
        withAuthorQuery(query) {
            expect(query).toEqual(expect.any(Function));
            return this;
        },
        buildProgram: async (macro) => {
            if (macro.warnings.length)
                throw new Error(
                    "Program author could not resolve the output requirements.",
                );
            return macroProgramArtifact(macro);
        },
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

describe("durable macro learning", () => {
    it("rejects a runtime that cannot bind the restricted child query", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        Reflect.deleteProperty(learner, "withAuthorQuery");
        await expect(manager.configureLearning(learner)).rejects.toThrow(
            "complete learning runtime",
        );
        await manager.close();
    });

    it("keeps trace-only captures nonlearning even when learning is selected", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        await manager.configureLearning(learner);
        const summary = await capture(manager);
        expect(summary.learningJobId).toBeUndefined();
        await expect(
            manager.prepareMacroLearning({ traceId: summary.traceId }),
        ).rejects.toThrow("re-record");
        expect(learner.extract).not.toHaveBeenCalled();
        await manager.close();
    });

    it("rejects selected learning without a child capture before saving a trace", async () => {
        const { manager, directory } = await setup("all");
        const trace = recordedTrace("missing-envelope");
        manager.armRecording({
            sessionId: trace.sessionId,
            learning: true,
            cwd,
        });
        const token = manager.claimRecording({
            sessionId: trace.sessionId,
            cwd,
            promptHash: createHash("sha256").update(trace.prompt).digest("hex"),
        })!;
        await expect(
            manager.finalizeRecording({ tokenId: token.id, trace }),
        ).rejects.toThrow("re-record");
        await expect(
            readFile(
                path.join(directory, "copilot-macros", "learning.json"),
                "utf8",
            ),
        ).resolves.not.toContain('"jobs":[{');
        await manager.close();
    });

    it.each(["queued", "building", "ready", "saved-catalog"] as const)(
        "persists a re-record failure for an old non-child %s job without authoring",
        async (status) => {
            const { manager, directory, host } = await setup("all");
            const summary = await capture(manager, { learning: true });
            await manager.close();
            const filename = path.join(
                directory,
                "copilot-macros",
                "learning.json",
            );
            const stored = JSON.parse(await readFile(filename, "utf8"));
            const job = stored.jobs[0];
            delete job.authoring;
            job.status = status === "saved-catalog" ? "failed" : status;
            if (status === "saved-catalog") {
                job.draft = { old: true };
                job.error = "catalog was saved";
            }
            await writeFile(filename, JSON.stringify(stored));
            const restarted = createManager(directory, host);
            const learner = runtime();
            await restarted.configureLearning(learner);
            expect(
                await restarted.getMacroLearningJob(summary.learningJobId!),
            ).toMatchObject({
                status: "failed",
                error: expect.stringContaining("re-record"),
            });
            expect(learner.extract).not.toHaveBeenCalled();
            expect(learner.build).not.toHaveBeenCalled();
            await restarted.close();
            expect(
                JSON.parse(await readFile(filename, "utf8")).jobs[0],
            ).toMatchObject({
                status: "failed",
                error: expect.stringContaining("re-record"),
            });
        },
    );

    it.each(["missing", "changed"] as const)(
        "rejects a persisted child job with %s sealed context across restart",
        async (kind) => {
            const { manager, directory, host } = await setup("all");
            const summary = await capture(manager, { learning: true });
            await manager.close();
            if (kind === "missing") {
                await rm(
                    path.join(
                        directory,
                        "copilot-macros",
                        "recipe-authoring-context",
                    ),
                    {
                        recursive: true,
                        force: true,
                    },
                );
            } else {
                const filename = path.join(
                    directory,
                    "copilot-macros",
                    "learning.json",
                );
                const stored = JSON.parse(await readFile(filename, "utf8"));
                stored.jobs[0].authoring.contextDigest = "0".repeat(64);
                await writeFile(filename, JSON.stringify(stored));
            }
            const restarted = createManager(directory, host);
            const learner = runtime();
            await restarted.configureLearning(learner);
            expect(
                await restarted.getMacroLearningJob(summary.learningJobId!),
            ).toMatchObject({
                status: "failed",
                error: expect.stringContaining("re-record"),
            });
            expect(learner.extract).not.toHaveBeenCalled();
            await restarted.close();
        },
    );

    it("rejects fabricated program provenance before saving or publishing", async () => {
        const { manager } = await setup("all");
        const learner = runtime();
        const author = learner.buildProgram;
        learner.buildProgram = async (...args) => {
            const program = await author(...args);
            program.provenance.tokenId = `legacy:${args[0].sourceTraceId}`;
            return sealRecipeArtifact(program);
        };
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        expect(await terminal(manager, summary.learningJobId!)).toMatchObject({
            status: "failed",
        });
        expect(await manager.listMacros()).toEqual([]);
        await manager.close();
    });

    it.each(["prompt", "response", "call"] as const)(
        "rejects direct reprocessing when the stored %s no longer matches its sealed capture",
        async (field) => {
            const { manager, directory, host } = await setup("all");
            const summary = await capture(manager, { learning: true });
            await manager.close();
            const filename = path.join(
                directory,
                "copilot-macros",
                "traces",
                `${summary.traceId}.json`,
            );
            const trace = JSON.parse(await readFile(filename, "utf8"));
            if (field === "call") trace.toolCalls[0].toolCallId = "other-call";
            else trace[field] = "Changed after sealing";
            await writeFile(filename, JSON.stringify(trace));
            const restarted = createManager(directory, host);
            await expect(
                restarted.prepareMacroLearning({ traceId: summary.traceId }),
            ).rejects.toThrow("does not match");
            const learner = runtime();
            await restarted.configureLearning(learner);
            expect(
                await terminal(restarted, summary.learningJobId!),
            ).toMatchObject({ status: "failed" });
            expect(learner.extract).not.toHaveBeenCalled();
        },
    );

    it("rejects manual publication of a staged draft whose persisted child identity was removed", async () => {
        const { manager, directory, host } = await setup("prepare");
        await manager.configureLearning(runtime());
        const summary = await capture(manager, { learning: true });
        const staged = await terminal(manager, summary.learningJobId!);
        expect(staged.status).toBe("needsReview");
        await manager.close();
        const filename = path.join(
            directory,
            "copilot-macros",
            "learning.json",
        );
        const stored = JSON.parse(await readFile(filename, "utf8"));
        delete stored.jobs[0].authoring;
        await writeFile(filename, JSON.stringify(stored));
        const restarted = createManager(directory, host);
        await restarted.configureLearning(runtime());
        await expect(restarted.approveMacro(staged.macro!)).rejects.toThrow(
            "re-record",
        );
        expect(await restarted.getApprovedMacros()).toEqual([]);
    });

    it("honors cancellation before acceptance and while the approved route is being loaded", async () => {
        const { manager } = await setup("all");
        manager.cancelMacroRun("pre-cancelled");
        await expect(
            manager.runMacro({ macroId: "not-loaded", runId: "pre-cancelled" }),
        ).rejects.toThrow("cancelled before acceptance");
        await manager.configureLearning(runtime());
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        expect(job.status).toBe("ready");
        let resume!: () => void;
        const paused = new Promise<void>((resolve) => {
            resume = resolve;
        });
        const inspect = manager.inspectMacro.bind(manager);
        const spy = jest
            .spyOn(manager, "inspectMacro")
            .mockImplementation(async (request) => {
                await paused;
                return inspect(request);
            });
        const execute = jest.fn(async () => {
            throw new Error("Cancelled preflight must never execute.");
        });
        manager.configureProgramRuntime({ execute });
        const running = manager.runMacro({
            ...job.macro!,
            runId: "cancel-preflight",
            inputs: { step_1_path: "package.json" },
        });
        manager.cancelMacroRun("cancel-preflight");
        resume();
        await expect(running).rejects.toThrow();
        expect(execute).not.toHaveBeenCalled();
        spy.mockRestore();
        await manager.close();
    });
    it("leaves interrupted authoring queued and refunds its attempt before owner handoff", async () => {
        const { manager, directory, host } = await setup("all");
        const summary = await capture(manager, { learning: true });
        let current = manager;
        for (let restart = 0; restart < 3; restart++) {
            const learner = runtime();
            let entered!: () => void;
            const started = new Promise<void>((resolve) => {
                entered = resolve;
            });
            let resume!: () => void;
            const paused = new Promise<void>((resolve) => {
                resume = resolve;
            });
            const originalExtract = learner.extract;
            learner.extract = async (...args) => {
                entered();
                await paused;
                return originalExtract(...args);
            };
            await current.configureLearning(learner);
            await started;
            await current.close();
            expect(
                (await current.getMacroLearningJob(summary.learningJobId!))
                    .status,
            ).toBe("queued");
            resume();
            await new Promise((resolve) => setTimeout(resolve, 5));
            current = createManager(directory, host);
        }
        await current.configureLearning(runtime());
        expect((await terminal(current, summary.learningJobId!)).status).toBe(
            "ready",
        );
        await current.close();
        await expect(current.configureLearning(runtime())).rejects.toThrow(
            "closed",
        );
    });

    it("prepares a verified historical trace through the same coordinator after restart", async () => {
        const { manager, directory, host } = await setup("all");
        const historical = await capture(manager, {
            sessionId: "historical-session",
            learning: true,
        });
        const restarted = createManager(directory, host);
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
        ).rejects.toThrow("re-record");
    });

    it("queues without a runtime, resumes after restart, and stages grammar for explicit v2 approval", async () => {
        const { manager, directory, host } = await setup();
        const summary = await capture(manager, { learning: true });
        const jobId = summary.learningJobId!;
        await expect(manager.getMacroLearningJob(jobId)).resolves.toMatchObject(
            { status: "queued" },
        );
        await expect(
            manager.getRecordingState("session-1"),
        ).resolves.toMatchObject({
            status: "completed",
            trace: summary,
            learningJob: { jobId, status: "queued" },
        });
        const restarted = createManager(directory, host);
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
            await expect(
                manager.getRecordingState("session-1"),
            ).resolves.toMatchObject({
                status: "completed",
                trace: summary,
                learningJob: job,
            });
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

    it.each(["failed", "denied"] as const)(
        "does not expose %s source traces to a model",
        async (status) => {
            const { manager } = await setup("all");
            const learner = runtime();
            await manager.configureLearning(learner);
            const trace = recordedTrace("bad-source");
            trace.toolCalls[0].status = status;
            await expect(
                capture(manager, { trace, learning: true }),
            ).rejects.toThrow("complete successful");
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
        await expect(
            capture(manager, { trace, learning: true }),
        ).rejects.toThrow("Secret-bearing");
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
        if (_description === "unsupported synthesis")
            expect(learner.generateGrammar).toHaveBeenCalled();
        else expect(learner.generateGrammar).not.toHaveBeenCalled();
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

    it("exposes actionable extraction uncertainties in recording status and persists them", async () => {
        const { manager, directory, host } = await setup();
        const learner = runtime();
        const extract = learner.extract;
        learner.extract = jest.fn(async (...args) => ({
            ...(await extract(...args)),
            programRequirements: ["Classify the captured read result"],
            uncertainties: [
                "The requested ranking was not performed by the recorded tools.",
                "The final report requires unsupported synthesis.",
            ],
        }));
        await manager.configureLearning(learner);
        const summary = await capture(manager, { learning: true });
        const job = await terminal(manager, summary.learningJobId!);
        expect(job.status).toBe("failed");
        expect(job.error).toContain("requested ranking");
        expect(job.error).toContain("unsupported synthesis");
        await expect(
            manager.getRecordingState("session-1"),
        ).resolves.toMatchObject({
            status: "completed",
            trace: summary,
            learningJob: job,
        });
        const restarted = createManager(directory, host);
        await expect(restarted.getMacroLearningJob(job.jobId)).resolves.toEqual(
            job,
        );
        const equivalent = await capture(manager, {
            learning: true,
            sessionId: "equivalent-failed-source",
        });
        expect(equivalent.learningJobId).not.toBe(job.jobId);
        expect(
            await terminal(manager, equivalent.learningJobId!),
        ).toMatchObject({
            status: "failed",
            traceId: equivalent.traceId,
            error: job.error,
        });
        expect(learner.extract).toHaveBeenCalledTimes(2);
        expect(learner.build).not.toHaveBeenCalled();
        expect(learner.generateGrammar).not.toHaveBeenCalled();
        expect(await manager.listMacros()).toEqual([]);
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it.each([
        ["bounded", "Unrecorded operation. ".repeat(150)],
        ["secret", "Missing authorization: Bearer synthetic-test-value"],
    ])(
        "keeps %s uncertainty diagnostics safe to persist",
        async (kind, uncertainty) => {
            const { manager, directory } = await setup();
            const learner = runtime();
            const extract = learner.extract;
            learner.extract = jest.fn(async (...args) => ({
                ...(await extract(...args)),
                uncertainties: [uncertainty],
            }));
            await manager.configureLearning(learner);
            const summary = await capture(manager, { learning: true });
            const job = await terminal(manager, summary.learningJobId!);
            expect(job.status).toBe("failed");
            if (kind === "bounded") {
                expect(job.error).toContain("Unrecorded operation.");
                expect(job.error).toHaveLength(2_000);
            } else {
                expect(job.error).toContain("Secret-bearing evidence");
                expect(
                    await readFile(
                        path.join(directory, "copilot-macros", "learning.json"),
                        "utf8",
                    ),
                ).not.toContain("synthetic-test-value");
            }
            expect(learner.build).not.toHaveBeenCalled();
            expect(await manager.listMacros()).toEqual([]);
        },
    );

    it("allows a fresh child capture to retry a failed equivalent without replacing its provenance", async () => {
        const { manager } = await setup();
        const learner = runtime();
        jest.spyOn(learner, "extract").mockRejectedValueOnce(
            new Error("Temporary author failure"),
        );
        await manager.configureLearning(learner);
        const first = await capture(manager, { learning: true });
        expect(await terminal(manager, first.learningJobId!)).toMatchObject({
            status: "failed",
        });
        expect(
            (
                await manager.prepareMacroLearning({
                    traceId: first.traceId,
                })
            ).jobId,
        ).toBe(first.learningJobId);
        expect(learner.extract).toHaveBeenCalledTimes(1);

        const second = await capture(manager, {
            sessionId: "fresh-child-session",
            learning: true,
        });
        expect(second.learningJobId).not.toBe(first.learningJobId);
        const retried = await terminal(manager, second.learningJobId!);
        expect(retried).toMatchObject({
            status: "needsReview",
            traceId: second.traceId,
            sessionId: "fresh-child-session",
            authoring: { captureId: second.traceId },
        });
        expect(
            await manager.getMacroLearningJob(first.learningJobId!),
        ).toMatchObject({
            status: "failed",
            traceId: first.traceId,
            authoring: { captureId: first.traceId },
        });
        expect(learner.extract).toHaveBeenCalledTimes(2);
    });

    it("deduplicates simultaneous submissions and equivalent traces before model work", async () => {
        const { manager } = await setup();
        const first = await capture(manager, { learning: true });
        const jobs = await Promise.all(
            Array.from({ length: 8 }, () =>
                manager.prepareMacroLearning({ traceId: first.traceId }),
            ),
        );
        expect(new Set(jobs.map((job) => job.jobId)).size).toBe(1);
        const second = await capture(manager, {
            sessionId: "other-session",
            learning: true,
        });
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
            const restarted = createManager(directory, host);
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
            childAuthoring: childCapture(trace, token.id),
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
        const restarted = createManager(directory, host);
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
        const restarted = createManager(directory, host);
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
        await expect(
            capture(manager, { learning: true, trace }),
        ).rejects.toThrow("complete successful");
        trace.sessionId = "incomplete-response";
        trace.toolCalls = [trace.toolCalls[0]];
        trace.response = "";
        await expect(
            capture(manager, { learning: true, trace }),
        ).rejects.toThrow("complete successful");
        expect(learner.extract).not.toHaveBeenCalled();
    });

    it("does not let an unsuccessful observation suppress later successful evidence", async () => {
        const { manager } = await setup("all");
        const trace = recordedTrace("failed-observation");
        trace.toolCalls[0].status = "failed";
        await expect(
            capture(manager, { learning: true, trace }),
        ).rejects.toThrow("complete successful");
        await manager.configureLearning(runtime());
        const succeeded = await capture(manager, {
            learning: true,
            sessionId: "successful-observation",
        });
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
            const restarted = createManager(directory, host);
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
        const restarted = createManager(directory, host);
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
