// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile, link } from "node:fs/promises";
import path from "node:path";
import {
    induceMacroFromTrace,
    type RecordedInteractionTrace,
} from "@typeagent/copilot-macros";
import {
    createSyntheticMacroLearningDiagnostics,
    syntheticMacroBuildResponsePolicyKind,
    nativeSyntheticGrammarDiagnosticContract,
} from "../src/macroLearningDiagnostics.js";
import {
    createMacroLearningRuntime,
    type MacroBuildResponseContext,
    type MacroGrammarContext,
    type MacroGrammarEvidence,
    validateMacroGrammar,
    replayMacroGrammarDiagnostic,
} from "../src/macroLearningRuntime.js";
import { getMacroActionName } from "../src/macroAgentProvider.js";
import { GrammarGenerator } from "@typeagent/action-grammar/generation";

const flag = "TYPEAGENT_MACRO_BUILD_RESPONSE_DIAGNOSTIC_POLICY";
const grammarFlag = "TYPEAGENT_MACRO_GRAMMAR_DIAGNOSTIC_POLICY";
const envKeys = [
    flag,
    grammarFlag,
    "TYPEAGENT_USER_DATA_DIR",
    "INSTANCE_NAME",
] as const;
const directories: string[] = [];
const originalEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
);
afterEach(async () => {
    jest.restoreAllMocks();
    for (const key of envKeys) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    }
    for (const directory of directories.splice(0))
        await rm(directory, { recursive: true, force: true });
});
async function fixture() {
    const root = path.resolve(`.macro-learning-diagnostic-${randomUUID()}`);
    directories.push(root);
    const dataRoot = path.join(root, "data"),
        owner = "12345678-diagnostic-owner";
    const instanceName = "macro-eval-12345678",
        instanceDir = path.join(dataRoot, "profiles", instanceName);
    const traceId = "trace-generated";
    const workspace = path.join(root, "workspace");
    const source = path.join(
        instanceDir,
        "copilot-macros",
        "traces",
        `${traceId}.json`,
    );
    const policyFile = path.join(dataRoot, "native-build-response-policy.json");
    process.env[flag] = policyFile;
    process.env.TYPEAGENT_USER_DATA_DIR = dataRoot;
    process.env.INSTANCE_NAME = instanceName;
    const options = createSyntheticMacroLearningDiagnostics(instanceDir)!;
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(workspace);
    const expectedToolCalls = [
        {
            name: "macro-eval-docs-lookup_document",
            mcpServerName: "macro-eval-docs",
            arguments: { title: "Generated title" },
        },
        {
            name: "macro-eval-docs-fetch_document",
            mcpServerName: "macro-eval-docs",
            arguments: { id: "synthetic-doc-generated" },
        },
    ];
    const policy = {
        schemaVersion: 1,
        kind: syntheticMacroBuildResponsePolicyKind,
        owner,
        ownedRoot: root,
        dataRoot,
        instanceName,
        configPath: path.join(root, "config.json"),
        expectedSessionId: "session-generated",
        expectedPrompt: "Find Generated title and show its contents.",
        expectedToolCalls,
        maxResponseBytes: 262144,
        maxResponses: 2,
    };
    await writeFile(policyFile, JSON.stringify(policy));
    const admission = {
        owner,
        ownedRoot: root,
        configPath: policy.configPath,
        nativeSyntheticOriginals: true,
    };
    const admissionFile = path.join(dataRoot, "native-control-admission.json");
    await writeFile(admissionFile, JSON.stringify(admission));
    const trace: RecordedInteractionTrace = {
        schemaVersion: 1,
        sessionId: policy.expectedSessionId,
        cwd: workspace,
        prompt: policy.expectedPrompt,
        response: "Generated only",
        startedAt: new Date(Date.now() + 20).toISOString(),
        completedAt: new Date(Date.now() + 40).toISOString(),
        toolCalls: expectedToolCalls.map((call, index) => ({
            ...call,
            toolCallId: `call-${index}`,
            status: "completed",
            result: { generated: true },
        })),
    };
    await writeFile(source, JSON.stringify(trace));
    const baseline = await induceMacroFromTrace(
        traceId,
        trace,
        "macro-generated",
        "Generated",
        "Generated",
        trace.completedAt,
    );
    const recipe = {
        schemaVersion: 1 as const,
        traceId,
        request: trace.prompt,
        toolCallIds: trace.toolCalls.map((call) => call.toolCallId),
        description: "Read generated document.",
        uncertainties: [],
    };
    const context: MacroBuildResponseContext = {
        phase: "initial",
        traceId,
        trace,
        baseline,
        recipe,
        requestSha256: "a".repeat(64),
    };
    return {
        root,
        dataRoot,
        owner,
        instanceDir,
        options,
        policy,
        policyFile,
        admission,
        admissionFile,
        source,
        trace,
        baseline,
        recipe,
        context,
    };
}

async function grammarFixture() {
    const f = await fixture();
    delete process.env[flag];
    const {
        maxResponseBytes: _bytes,
        maxResponses: _responses,
        ...scope
    } = f.policy;
    const policy = {
        ...scope,
        kind: nativeSyntheticGrammarDiagnosticContract,
        expectedPrompt: "read Generated title now",
        maxArtifactBytes: 262144,
        maxArtifacts: 1,
    };
    const policyFile = path.join(f.dataRoot, "native-grammar-policy.json");
    process.env[grammarFlag] = policyFile;
    await writeFile(policyFile, JSON.stringify(policy));
    f.trace.prompt = policy.expectedPrompt;
    f.trace.startedAt = new Date(Date.now() + 20).toISOString();
    f.trace.completedAt = new Date(Date.now() + 40).toISOString();
    await writeFile(f.source, JSON.stringify(f.trace));
    const context: MacroGrammarContext = {
        macro: { ...f.baseline, state: "approved", version: 2 },
        actionName: getMacroActionName({ ...f.baseline, version: 2 }),
        requests: [policy.expectedPrompt],
        exampleInputs: { path: "Generated title" },
    };
    const tuple = {
        rules: [
            `<Start> = read $(path:string) now -> { actionName: "${context.actionName}", parameters: { path } };`,
        ],
        requests: context.requests,
        actionName: context.actionName,
        exampleInputs: context.exampleInputs,
    };
    const evidence: MacroGrammarEvidence = {
        tuple,
        observations: [],
        outcome: "passed",
    };
    const options = createSyntheticMacroLearningDiagnostics(f.instanceDir)!;
    const output = path.join(
        f.dataRoot,
        "native-grammar-evidence",
        f.owner,
        context.macro.sourceTraceId,
        "grammar.json",
    );
    return { ...f, policy, policyFile, options, context, evidence, output };
}

describe("owned synthetic grammar diagnostics", () => {
    it("losslessly annotates unset optional matcher values without losing the replay tuple", async () => {
        const f = await grammarFixture(),
            signal = new AbortController().signal;
        f.evidence.observations.push({
            stage: "positive",
            request: f.context.requests[0],
            parameters: f.context.exampleInputs,
            matches: [
                undefined,
                { parameters: { optional: undefined, number: NaN } },
                null,
            ],
        });
        await f.options.grammarEvidence!.assertSource(f.context, signal);
        await f.options.grammarEvidence!.retainResult(
            f.context,
            f.evidence,
            signal,
        );
        const record = JSON.parse(await readFile(f.output, "utf8"));
        expect(record.tuple).toEqual(f.evidence.tuple);
        expect(record.observations[0].matches).toEqual([
            null,
            { parameters: { optional: null, number: null } },
            null,
        ]);
        expect(record.observations[0].nonJsonValues).toEqual([
            { path: [0], type: "undefined" },
            { path: [1, "parameters", "optional"], type: "undefined" },
            { path: [1, "parameters", "number"], type: "NaN" },
        ]);
    });
    it.each(["retained", "label", "throw"])(
        "captures actual runtime-generated rules/matches with no %s result fallback",
        async (kind) => {
            const f = await grammarFixture();
            f.context.macro.inputs = [];
            f.context.exampleInputs = {};
            const rules = `<Start> = <${f.context.actionName}>;\n<${f.context.actionName}> = read Generated title now -> { actionName: "wrong" };`;
            const generate = jest
                .spyOn(GrammarGenerator.prototype, "generateGrammar")
                .mockResolvedValue({
                    shouldGenerateGrammar: true,
                    requestAnalysis: { sentences: [] },
                    parameterMappings: [],
                    fixedPhrases: [],
                    grammarPattern: {
                        matchPattern: "read Generated title now",
                        actionParameters: [],
                    },
                    reasoning: "Unit fixture",
                });
            jest.spyOn(
                GrammarGenerator.prototype,
                "formatAsGrammarRule",
            ).mockReturnValue(rules);
            if (kind !== "retained") {
                const retain = f.options.grammarEvidence!.retainResult;
                Object.assign(f.options.grammarEvidence!, {
                    retainResult: jest.fn(
                        async (...args: Parameters<typeof retain>) => {
                            await retain(...args);
                            if (kind === "throw")
                                throw new Error("Private retention failed");
                            return "untrusted-result";
                        },
                    ),
                });
            }
            const query = jest.fn(async () => "{}");
            await expect(
                createMacroLearningRuntime(
                    query,
                    undefined,
                    f.options,
                ).generateGrammar(
                    f.context.macro,
                    f.context.exampleInputs,
                    f.context.requests,
                    new AbortController().signal,
                ),
            ).rejects.toThrow(
                kind === "retained"
                    ? "expected action/inputs"
                    : kind === "throw"
                      ? "Private retention failed"
                      : "must return undefined",
            );
            expect(generate).toHaveBeenCalledTimes(1);
            expect(query).not.toHaveBeenCalled();
            const record = JSON.parse(await readFile(f.output, "utf8"));
            expect(record.tuple).toEqual({
                rules: [rules],
                requests: f.context.requests,
                exampleInputs: {},
                actionName: f.context.actionName,
            });
            expect(record.observations[0].matches).toEqual([
                { actionName: "wrong" },
            ]);
            expect(record.outcome).toBe("failed");
            expect(() => replayMacroGrammarDiagnostic(record.tuple)).toThrow(
                "expected action/inputs",
            );
        },
    );
    it("is separately lazy/default-off and never enables BUILD retention", () => {
        delete process.env[flag];
        delete process.env[grammarFlag];
        expect(
            createSyntheticMacroLearningDiagnostics("nonexistent"),
        ).toBeUndefined();
        process.env[grammarFlag] = path.resolve("not-created-policy.json");
        expect(
            createSyntheticMacroLearningDiagnostics("nonexistent"),
        ).toHaveProperty("grammarEvidence");
        expect(
            createSyntheticMacroLearningDiagnostics("nonexistent"),
        ).not.toHaveProperty("buildResponseEvidence");
    });
    it("retains the exact private tuple and actual matches before replaying the strict guard", async () => {
        const f = await grammarFixture(),
            signal = new AbortController().signal;
        validateMacroGrammar(
            f.evidence.tuple.rules,
            f.context.requests,
            f.context.actionName,
            f.context.exampleInputs,
            (observation) => f.evidence.observations.push(observation),
        );
        await f.options.grammarEvidence!.assertSource(f.context, signal);
        await f.options.grammarEvidence!.retainResult(
            f.context,
            f.evidence,
            signal,
        );
        const record = JSON.parse(await readFile(f.output, "utf8"));
        expect(record).toMatchObject({
            sensitive: true,
            admission: false,
            kind: "native-synthetic-grammar-evidence-v1",
            ...f.evidence,
        });
        expect(record.observations[0].matches).toEqual([
            {
                actionName: f.context.actionName,
                parameters: f.context.exampleInputs,
            },
        ]);
        expect(() => replayMacroGrammarDiagnostic(record.tuple)).not.toThrow();
        expect(JSON.stringify(record)).not.toContain("Generated only");
        await expect(
            f.options.grammarEvidence!.retainResult(
                f.context,
                f.evidence,
                signal,
            ),
        ).rejects.toThrow("grammar-artifact-budget");
    });
    it("preserves actual wrong-input matches and strict replay rejection without a result fallback", async () => {
        const f = await grammarFixture(),
            signal = new AbortController().signal;
        f.evidence.tuple.rules = [
            `<Start> = read $(path:string) now -> { actionName: "${f.context.actionName}", parameters: { path: "PRIVATE-WRONG-INPUT" } };`,
        ];
        f.evidence.outcome = "failed";
        expect(() =>
            validateMacroGrammar(
                f.evidence.tuple.rules,
                f.context.requests,
                f.context.actionName,
                f.context.exampleInputs,
                (observation) => f.evidence.observations.push(observation),
            ),
        ).toThrow("expected action/inputs");
        await f.options.grammarEvidence!.assertSource(f.context, signal);
        await f.options.grammarEvidence!.retainResult(
            f.context,
            f.evidence,
            signal,
        );
        const record = JSON.parse(await readFile(f.output, "utf8"));
        expect(record.observations[0].matches[0].parameters.path).toBe(
            "PRIVATE-WRONG-INPUT",
        );
        expect(() => replayMacroGrammarDiagnostic(record.tuple)).toThrow(
            "expected action/inputs",
        );
    });
    it.each([
        "owner",
        "session",
        "tools",
        "v2",
        "budget",
        "stale",
        "environment",
        "admission",
        "action",
        "secret",
    ])("rejects %s before grammar queries", async (kind) => {
        const f = await grammarFixture();
        if (kind === "owner") f.policy.owner = "foreign";
        if (kind === "session") f.trace.sessionId = "foreign";
        if (kind === "tools") f.trace.toolCalls[0].name = "tenant-read";
        if (kind === "v2") f.trace.schemaVersion = 2;
        if (kind === "budget") f.policy.maxArtifacts = 2;
        if (kind === "stale") f.trace.startedAt = "2000-01-01T00:00:00.000Z";
        if (kind === "environment") process.env.INSTANCE_NAME = "foreign";
        if (kind === "admission") f.admission.nativeSyntheticOriginals = false;
        if (kind === "action") f.context.actionName = "foreign";
        if (kind === "secret") f.context.macro.inputs[0].secret = true;
        await writeFile(f.policyFile, JSON.stringify(f.policy));
        await writeFile(f.source, JSON.stringify(f.trace));
        await writeFile(f.admissionFile, JSON.stringify(f.admission));
        const query = jest.fn(async () => "{}");
        const invoke =
            kind === "action"
                ? f.options.grammarEvidence!.assertSource(
                      f.context,
                      new AbortController().signal,
                  )
                : createMacroLearningRuntime(
                      query,
                      undefined,
                      f.options,
                  ).generateGrammar(
                      f.context.macro,
                      f.context.exampleInputs,
                      f.context.requests,
                      new AbortController().signal,
                  );
        await expect(invoke).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
    });
    it.each([
        "oversize",
        "overwrite",
        "hardlink",
        "drift",
        "unreserved",
        "encoding",
    ])("fails closed on %s without truncation", async (kind) => {
        const f = await grammarFixture(),
            signal = new AbortController().signal;
        if (kind !== "unreserved")
            await f.options.grammarEvidence!.assertSource(f.context, signal);
        if (kind === "oversize") f.evidence.tuple.rules = ["x".repeat(262145)];
        if (kind === "encoding")
            f.evidence.observations.push({
                stage: "positive",
                request: "read Generated title now",
                parameters: f.context.exampleInputs,
                matches: [() => "unsupported"],
            });
        if (kind === "overwrite") {
            await mkdir(path.dirname(f.output), { recursive: true });
            await writeFile(f.output, "original");
        }
        if (kind === "hardlink")
            await link(f.source, path.join(f.root, "source-link.json"));
        if (kind === "drift") {
            f.policy.expectedPrompt = "foreign";
            await writeFile(f.policyFile, JSON.stringify(f.policy));
        }
        await expect(
            f.options.grammarEvidence!.retainResult(
                f.context,
                f.evidence,
                signal,
            ),
        ).rejects.toThrow();
        if (kind === "overwrite")
            expect(await readFile(f.output, "utf8")).toBe("original");
    });
    it("rejects cancellation and non-void source labels before any query", async () => {
        const f = await grammarFixture(),
            query = jest.fn(async () => "{}");
        const controller = new AbortController();
        controller.abort();
        await expect(
            createMacroLearningRuntime(
                query,
                undefined,
                f.options,
            ).generateGrammar(
                f.context.macro,
                f.context.exampleInputs,
                f.context.requests,
                controller.signal,
            ),
        ).rejects.toThrow();
        Object.assign(f.options.grammarEvidence!, {
            assertSource: jest.fn(async () => "not trusted"),
        });
        await expect(
            createMacroLearningRuntime(
                query,
                undefined,
                f.options,
            ).generateGrammar(
                f.context.macro,
                f.context.exampleInputs,
                f.context.requests,
                new AbortController().signal,
            ),
        ).rejects.toThrow("must return undefined");
        expect(query).not.toHaveBeenCalled();
    });
});
describe("owned synthetic build diagnostics", () => {
    it("defaults off and is lazy even when an opted-in policy does not exist at startup", () => {
        delete process.env[flag];
        expect(
            createSyntheticMacroLearningDiagnostics(
                path.resolve("nonexistent"),
            ),
        ).toBeUndefined();
        process.env[flag] = path.resolve("nonexistent-policy.json");
        expect(
            createSyntheticMacroLearningDiagnostics(
                path.resolve("nonexistent"),
            ),
        ).toHaveProperty("buildResponseEvidence");
    });
    it("retains ORIGINAL malformed build response before strict parser rejection without console/model exposure", async () => {
        const f = await fixture();
        const raw = '{"macroId":"GENERATED-ORIGINAL-ONLY","unsupported":true}';
        const query = jest.fn(async () => raw);
        await expect(
            createMacroLearningRuntime(query, undefined, f.options).build(
                f.recipe,
                f.trace,
                f.baseline,
                new AbortController().signal,
            ),
        ).rejects.toThrow("At build");
        expect(query).toHaveBeenCalledTimes(1);
        const record = JSON.parse(
            await readFile(
                path.join(
                    f.dataRoot,
                    "native-build-response-evidence",
                    f.owner,
                    f.context.traceId,
                    "initial.json",
                ),
                "utf8",
            ),
        );
        expect(record.originalResponse).toBe(raw);
        expect(record.responseSha256).toBe(
            createHash("sha256").update(raw).digest("hex"),
        );
        expect(record.responseSizeBytes).toBe(Buffer.byteLength(raw));
        expect(record).toMatchObject({
            admission: false,
            sensitive: true,
            phase: "initial",
            traceId: f.context.traceId,
        });
        await expect(
            f.options.buildResponseEvidence!.assertSource(
                f.context,
                new AbortController().signal,
            ),
        ).rejects.toThrow("response-budget");
    });
    it.each([
        "owner",
        "session",
        "tools",
        "arguments",
        "v2",
        "response-cap",
        "phase",
        "environment",
        "missing-policy",
        "admission",
    ])("denies %s before any model request", async (kind) => {
        const f = await fixture();
        if (kind === "owner") f.policy.owner = "foreign";
        if (kind === "session") f.trace.sessionId = "foreign";
        if (kind === "tools") f.trace.toolCalls[0].name = "workiq-retrieve";
        if (kind === "arguments")
            f.trace.toolCalls[0].arguments = { title: "foreign" };
        if (kind === "v2") f.trace.schemaVersion = 2;
        if (kind === "response-cap") f.policy.maxResponseBytes = 262145;
        if (kind === "phase") f.context.phase = "grounding-correction";
        if (kind === "environment") process.env.INSTANCE_NAME = "foreign";
        if (kind === "admission") f.admission.nativeSyntheticOriginals = false;
        await writeFile(f.policyFile, JSON.stringify(f.policy));
        await writeFile(f.admissionFile, JSON.stringify(f.admission));
        await writeFile(f.source, JSON.stringify(f.trace));
        if (kind === "missing-policy") await rm(f.policyFile);
        const query = jest.fn(async () => "{}");
        const invoke =
            kind === "phase"
                ? f.options.buildResponseEvidence!.assertSource(
                      f.context,
                      new AbortController().signal,
                  )
                : createMacroLearningRuntime(query, undefined, f.options).build(
                      f.recipe,
                      f.trace,
                      f.baseline,
                      new AbortController().signal,
                  );
        await expect(invoke).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
    });
    it("rejects hardlinked source files", async () => {
        const f = await fixture();
        await link(f.source, path.join(f.root, "source-link.json"));
        await expect(
            f.options.buildResponseEvidence!.assertSource(
                f.context,
                new AbortController().signal,
            ),
        ).rejects.toThrow("unsafe-file");
    });
    it("checks current owner admission without freezing its mutable catalog bytes", async () => {
        const f = await fixture(),
            signal = new AbortController().signal;
        await f.options.buildResponseEvidence!.assertSource(f.context, signal);
        await writeFile(
            f.admissionFile,
            JSON.stringify({ ...f.admission, stage: "catalog-ready" }),
        );
        await f.options.buildResponseEvidence!.retainResponse(
            f.context,
            "{}",
            signal,
        );
        await expect(
            f.options.buildResponseEvidence!.retainResponse(
                f.context,
                "{}",
                signal,
            ),
        ).rejects.toThrow("response-budget");
    });
    it("never clips oversized raw responses or proceeds after retention failure", async () => {
        const f = await fixture(),
            query = jest.fn(async () => "x".repeat(262145));
        await expect(
            createMacroLearningRuntime(query, undefined, f.options).build(
                f.recipe,
                f.trace,
                f.baseline,
                new AbortController().signal,
            ),
        ).rejects.toThrow("bounded original text");
        expect(query).toHaveBeenCalledTimes(1);
    });
    it.each([
        "PRIVATE-ORIGINAL-NOT-JSON",
        '{"error":"PRIVATE-ORIGINAL-ERROR"}',
    ])(
        "privately retains invalid JSON/explicit errors without echoing raw values",
        async (raw) => {
            const f = await fixture(),
                query = jest.fn(async () => raw);
            try {
                await createMacroLearningRuntime(
                    query,
                    undefined,
                    f.options,
                ).build(
                    f.recipe,
                    f.trace,
                    f.baseline,
                    new AbortController().signal,
                );
                throw new Error("Expected strict rejection.");
            } catch (error) {
                expect(String(error)).toContain("original retained privately");
                expect(String(error)).not.toContain("PRIVATE-ORIGINAL");
            }
            const record = JSON.parse(
                await readFile(
                    path.join(
                        f.dataRoot,
                        "native-build-response-evidence",
                        f.owner,
                        f.context.traceId,
                        "initial.json",
                    ),
                    "utf8",
                ),
            );
            expect(record.originalResponse).toBe(raw);
        },
    );
    it("rejects immutable policy drift and retention-only calls", async () => {
        const f = await fixture(),
            signal = new AbortController().signal;
        await expect(
            f.options.buildResponseEvidence!.retainResponse(
                f.context,
                "{}",
                signal,
            ),
        ).rejects.toThrow("response-budget");
        await f.options.buildResponseEvidence!.assertSource(f.context, signal);
        await writeFile(
            f.policyFile,
            JSON.stringify({ ...f.policy, expectedPrompt: "foreign" }),
        );
        await expect(
            f.options.buildResponseEvidence!.retainResponse(
                f.context,
                "{}",
                signal,
            ),
        ).rejects.toThrow();
    });
    it("does not proceed to parsing when the private evidence path cannot be written", async () => {
        const f = await fixture();
        await writeFile(
            path.join(f.dataRoot, "native-build-response-evidence"),
            "not a directory",
        );
        const query = jest.fn(async () => '{"macroId":"GENERATED"}');
        await expect(
            createMacroLearningRuntime(query, undefined, f.options).build(
                f.recipe,
                f.trace,
                f.baseline,
                new AbortController().signal,
            ),
        ).rejects.toThrow("output-directory");
        expect(query).toHaveBeenCalledTimes(1);
    });
    it("binds one fresh source trace and retains at most the two distinct build phases", async () => {
        const f = await fixture(),
            signal = new AbortController().signal,
            observer = f.options.buildResponseEvidence!;
        await observer.assertSource(f.context, signal);
        await observer.retainResponse(f.context, "initial-original", signal);
        const foreign = {
            ...f.context,
            traceId: "foreign-trace",
            phase: "grounding-correction" as const,
            recipe: { ...f.recipe, traceId: "foreign-trace" },
            baseline: { ...f.baseline, sourceTraceId: "foreign-trace" },
        };
        await writeFile(
            path.join(path.dirname(f.source), "foreign-trace.json"),
            JSON.stringify(f.trace),
        );
        await expect(observer.assertSource(foreign, signal)).rejects.toThrow(
            "scope-drift",
        );
        const correction = {
            ...f.context,
            phase: "grounding-correction" as const,
        };
        await observer.assertSource(correction, signal);
        await observer.retainResponse(
            correction,
            "correction-original",
            signal,
        );
        await expect(observer.assertSource(correction, signal)).rejects.toThrow(
            "response-budget",
        );
    });
    it("cancellation and source/retention labels never replace trusted void assertions", async () => {
        const f = await fixture(),
            query = jest.fn(async () => "{}"),
            controller = new AbortController();
        controller.abort();
        await expect(
            createMacroLearningRuntime(query, undefined, f.options).build(
                f.recipe,
                f.trace,
                f.baseline,
                controller.signal,
            ),
        ).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
        const options = {
            buildResponseEvidence: {
                assertSource: jest.fn(async () => true),
                retainResponse: jest.fn(async () => {}),
            },
        };
        await expect(
            createMacroLearningRuntime(
                query,
                undefined,
                options as unknown as typeof f.options,
            ).build(
                f.recipe,
                f.trace,
                f.baseline,
                new AbortController().signal,
            ),
        ).rejects.toThrow("must return undefined");
        expect(query).not.toHaveBeenCalled();
    });
    it.each([
        { owner: null },
        { configPath: 42 },
        { expectedToolCalls: [null, null] },
    ])(
        "rejects malformed policy fields before querying without value-bearing type errors",
        async (patch) => {
            const f = await fixture(),
                query = jest.fn(async () => "{}");
            await writeFile(
                f.policyFile,
                JSON.stringify({ ...f.policy, ...patch }),
            );
            await expect(
                createMacroLearningRuntime(query, undefined, f.options).build(
                    f.recipe,
                    f.trace,
                    f.baseline,
                    new AbortController().signal,
                ),
            ).rejects.toThrow("Synthetic build response diagnostics rejected");
            expect(query).not.toHaveBeenCalled();
        },
    );
    it("rejects source and request-hash drift between query authorization and retention", async () => {
        const f = await fixture(),
            signal = new AbortController().signal,
            observer = f.options.buildResponseEvidence!;
        await observer.assertSource(f.context, signal);
        await expect(
            observer.retainResponse(
                { ...f.context, requestSha256: "b".repeat(64) },
                "{}",
                signal,
            ),
        ).rejects.toThrow("response-budget");
        f.trace.response = "mutated-generated-only";
        await writeFile(f.source, JSON.stringify(f.trace));
        await expect(
            observer.retainResponse(f.context, "{}", signal),
        ).rejects.toThrow("scope-drift");
    });
});
