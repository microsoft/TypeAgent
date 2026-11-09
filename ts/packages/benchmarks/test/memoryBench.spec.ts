// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { BenchmarkResponseError } from "@typeagent/memory-service/benchmark";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    beamSessions,
    beamTurns,
    chunkTurns,
    timestamp,
} from "../src/memoryBench/normalize.js";
import {
    documentsFrom,
    queriesFor,
    selectQueries,
    loadDataset,
    beamRevisions,
    beamSplits,
    validateDataset,
} from "../src/memoryBench/data.js";
import { parseLiteral } from "../src/memoryBench/literal.js";
import { MemoryProvider } from "../src/memoryBench/provider.js";
import {
    bm25Retrieve,
    bm25Scores,
    clampScore,
    judge,
    orderingScore,
    tokenChunks,
} from "../src/memoryBench/scoring.js";
import { render } from "../src/memoryBench/protocol.js";
import {
    object,
    saveJson,
    updateProgress,
    bytesHash,
} from "../src/memoryBench/storage.js";
import {
    runStage,
    run,
    validateOptions,
    type RunOptions,
} from "../src/memoryBench/runner.js";
import {
    document,
    FakeHost,
    protocol,
    syntheticData,
} from "./memoryBenchFixtures.js";

describe("memory benchmark normalization and data fidelity", () => {
    test("BEAM identities, source metadata and evaluator separation", () => {
        const turns = beamTurns([
            [
                {
                    id: "a",
                    role: "user",
                    content: "Tea",
                    time_anchor: "May-08-2023",
                    answer: "GOLD_ONLY",
                },
                { id: "b", role: "assistant", content: "Noted" },
            ],
        ]);
        expect(turns.map((turn) => turn.originalId)).toEqual(["a", "b"]);
        expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
        expect(turns.map((turn) => turn.speaker)).toEqual([
            "user",
            "assistant",
        ]);
        expect(turns[0].content).toContain("turn a; speaker user");
        expect(JSON.stringify(turns)).not.toContain("GOLD_ONLY");
        expect(turns[0].timestamp).toBe("2023-05-08T00:00:00+00:00");
    });
    test("flat, nested and grouped layouts preserve roles and sparse session time", () => {
        const turns = [
            {
                role: "user",
                id: 0,
                content: "Tea.",
                time_anchor: "March-15-2024",
            },
            { role: "assistant", id: 1, content: "Noted." },
        ];
        for (const layout of [
            turns,
            [turns],
            [{ turns: [turns] }],
            [{ "plan-1": [{ turns: [turns.slice(0, 1), turns.slice(1)] }] }],
        ]) {
            const result = beamTurns(layout);
            expect(result.map((turn) => turn.text)).toEqual(["Tea.", "Noted."]);
            expect(result.map((turn) => turn.role)).toEqual([
                "user",
                "assistant",
            ]);
            expect(result.map((turn) => turn.timestamp)).toEqual([
                "2024-03-15T00:00:00+00:00",
                "2024-03-15T00:00:00+00:00",
            ]);
            expect(result.map((turn) => turn.timeSource)).toEqual([
                "turn",
                "session",
            ]);
        }
    });
    test("unknown layouts, absent dates, invalid dates and empty content fail explicitly", () => {
        for (const value of [
            [],
            [{ unknown: [] }],
            [{ turns: [{ bad: "data" }] }],
        ])
            expect(() => beamSessions(value)).toThrow();
        expect(() =>
            beamTurns([[{ role: "user", content: "Undated" }]]),
        ).toThrow();
        expect(() => timestamp("yesterday")).toThrow();
        expect(() => timestamp("February-31-2024")).toThrow();
        expect(() =>
            beamTurns([
                [{ role: "user", content: " ", time_anchor: "May-01-2024" }],
            ]),
        ).toThrow();
    });
    test("chunk boundaries never discard or split turns or merge sessions", () => {
        const turns = beamTurns([
            [{ role: "user", content: "Tea", time_anchor: "May-01-2024" }],
            [
                {
                    role: "assistant",
                    content: "Noted",
                    time_anchor: "May-02-2024",
                },
            ],
        ]);
        expect(chunkTurns(turns, 10000)).toEqual([[turns[0]], [turns[1]]]);
        expect(chunkTurns(turns, 1).flat()).toEqual(turns);
        expect(() => chunkTurns(turns, 0)).toThrow();
    });
    test("BEAM answer aliases, category sampling, and gold-data separation", () => {
        const queries = queriesFor(syntheticData);
        expect(queries[0].goldAnswers).toEqual(["Tea"]);
        expect(
            selectQueries(
                [...queries, { ...queries[0], id: "second" }],
                "smoke",
            ),
        ).toHaveLength(1);
        const docs = documentsFrom(syntheticData, new Set(["alice"]));
        expect(JSON.stringify(docs)).not.toContain("JUDGE_ONLY");
        expect(docs[0].messages[0].originalId).toBe("0");
        expect(() =>
            queriesFor([{ ...syntheticData[0], probing_questions: {} }]),
        ).toThrow();
    });
    test("only the BEAM dataset and its four length tiers are supported", () => {
        expect(beamSplits).toEqual(["100k", "500k", "1m", "10m"]);
        for (const split of beamSplits)
            expect(() => validateDataset("beam", split)).not.toThrow();
        expect(() => validateDataset("unsupported", "100k")).toThrow(
            "Unsupported dataset",
        );
        expect(() => validateDataset("beam", "unsupported")).toThrow(
            "Unknown BEAM split",
        );
    });
    test("restricted literal parser supports upstream data but never evaluates expressions", () => {
        expect(
            parseLiteral(
                "{'question': 'Don\\'t forget', 'values': [True, None, 1.5,],}",
            ),
        ).toEqual({ question: "Don't forget", values: [true, null, 1.5] });
        expect(() => parseLiteral("__import__('os').system('bad')")).toThrow();
        expect(() => parseLiteral("{} trailing")).toThrow();
        expect(() => parseLiteral("'unfinished")).toThrow();
    });
});

describe("memory benchmark numeric parity (Python reference fixtures)", () => {
    test("BM25Okapi scores including negative IDF epsilon match within 1e-12", () => {
        const actual = bm25Scores(
            [
                "tea tea tea coffee",
                "tea bread",
                "coffee milk",
                "bread milk honey",
                "tea tea",
            ],
            "tea milk tea honey",
        );
        const reference = [
            0.26022867689081314, 0.19768444553508122, 0.375462581637405,
            1.3421653833641147, 0.2733559395232874,
        ];
        actual.forEach((value, index) =>
            expect(Math.abs(value - reference[index])).toBeLessThan(1e-12),
        );
    });
    test("cl100k token chunks match tiktoken including split Unicode bytes", () => {
        expect(tokenChunks("ab\u{1f600}cd\u{1f600}\u00e9", 1)).toEqual([
            "ab",
            "\ufffd",
            "\ufffd",
            "cd",
            "\ufffd",
            "\ufffd",
            "\u00e9",
        ]);
        expect(tokenChunks("<|endoftext|>", 512)).toEqual(["<|endoftext|>"]);
    });
    test("tied and missing-item Kendall tau-b and F1 match scipy reference", () => {
        const cases = [
            {
                actual: ["a", "b", "c"],
                expected: { f1: 1, tauNorm: 1, finalScore: 1 },
            },
            {
                actual: ["c", "b", "a"],
                expected: { f1: 1, tauNorm: 0, finalScore: 0 },
            },
            {
                actual: ["a", "c", "x"],
                expected: { f1: 2 / 3, tauNorm: 2 / 3, finalScore: 4 / 9 },
            },
            {
                actual: ["a"],
                expected: {
                    f1: 0.5,
                    tauNorm: 0.908248290463863,
                    finalScore: 0.4541241452319315,
                },
            },
            { actual: [], expected: { f1: 0, tauNorm: 0, finalScore: 0 } },
            {
                actual: ["a", "a", "c"],
                expected: { f1: 2 / 3, tauNorm: 2 / 3, finalScore: 4 / 9 },
            },
        ];
        for (const { actual, expected } of cases) {
            const result = orderingScore(["a", "b", "c"], actual);
            for (const key of ["f1", "tauNorm", "finalScore"] as const)
                expect(Math.abs(result[key] - expected[key])).toBeLessThan(
                    1e-12,
                );
        }
    });
    test("rubric thresholds and malformed judge scores", () => {
        expect([0, 0.24, 0.25, 0.74, 0.75, 1].map(clampScore)).toEqual([
            0, 0, 0.5, 0.5, 1, 1,
        ]);
        expect(() => clampScore("1")).toThrow();
        expect(() => clampScore(NaN)).toThrow();
    });
    test("BM25 does not fall back to another conversation and keeps stable ties", () => {
        const docs = [document("alice", "First"), document("bob", "Second")];
        expect(
            bm25Retrieve(docs, "absent", "alice").map((item) => item.content),
        ).toEqual([docs[0].content]);
        expect(() => bm25Retrieve(docs, "absent", "unknown")).toThrow();
    });
    test("template interpolation preserves literal braces and rejects missing values", () => {
        expect(render("{{literal}} {query}", { query: "{unexpanded}" })).toBe(
            "{literal} {unexpanded}",
        );
        expect(() => render("{missing}", {})).toThrow();
    });
});

describe("memory benchmark provider and orchestration", () => {
    let directory: string,
        host: FakeHost,
        provider: MemoryProvider,
        options: RunOptions;
    beforeEach(async () => {
        directory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-memory-ts-"),
        );
        host = new FakeHost();
        provider = new MemoryProvider(host, "fixture");
        await provider.prepare(
            path.join(directory, "provider"),
            new Set(["alice", "bob"]),
        );
        const input = path.join(directory, "input.json"),
            protocolFile = path.join(directory, "protocol.json");
        await saveJson(input, syntheticData);
        await saveJson(protocolFile, protocol);
        options = {
            repo: fileURLToPath(new URL("../../../../..", import.meta.url)),
            output: path.join(directory, "runs"),
            progress: path.join(directory, "progress.json"),
            cache: path.join(directory, "cache"),
            protocol: protocolFile,
            input,
            dataset: "beam",
            split: "100k",
            stage: "smoke",
            provider: "content",
            mode: "rag",
        };
    });
    afterEach(async () => rm(directory, { recursive: true, force: true }));
    const runtime = (host: FakeHost) => async () => ({
        bridge: host,
        close: async () => {
            host.closed = true;
        },
    });
    test("isolation, idempotency, restart and changed-content rejection", async () => {
        const docs = [document("alice", "Tea"), document("bob", "Coffee")];
        await provider.ingest(docs);
        await provider.ingest(docs);
        expect(
            host.calls.filter((call) => call.operation === "ingestBatch"),
        ).toHaveLength(2);
        const recovered = new MemoryProvider(host, "fixture");
        await recovered.prepare(
            path.join(directory, "provider"),
            new Set(["alice", "bob"]),
        );
        await recovered.ingest(docs);
        const evidence = await recovered.retrieve("Tea", "alice");
        expect(evidence.map((doc) => doc.content)).toEqual([docs[0].content]);
        await expect(recovered.retrieve("Tea", "unknown")).rejects.toThrow();
        await expect(
            recovered.ingest([document("alice", "Changed")]),
        ).rejects.toThrow(/changed/);
        await expect(
            new MemoryProvider(host, "different").prepare(
                path.join(directory, "provider"),
                new Set(),
            ),
        ).rejects.toThrow(/fingerprint/);
    });
    test("incomplete imports cannot be queried and resume without losing sources", async () => {
        host.failImport = true;
        await expect(provider.ingest([document()])).rejects.toThrow(
            "index failed",
        );
        await expect(provider.retrieve("Tea", "alice")).rejects.toThrow(
            /incomplete/,
        );
        host.failImport = false;
        await provider.ingest([document()]);
        expect(await provider.retrieve("Tea", "alice")).toHaveLength(1);
    });
    test("native extractive fallback is rejected; event turns and native-mode restrictions are explicit", async () => {
        host.nativeMode = "extractive";
        await expect(provider.directAnswer("Tea", "alice")).rejects.toThrow(
            /extractive/,
        );
        const events = new MemoryProvider(host, "events", true);
        await events.prepare(
            path.join(directory, "events"),
            new Set(["alice"]),
        );
        await expect(
            events.ingest([{ ...document(), messages: [] }]),
        ).rejects.toThrow(/original turns/);
        await expect(events.directAnswer("Tea", "alice")).rejects.toThrow(
            /not implemented/,
        );
    });
    test("event ingestion retains original role/time metadata and rejects cross-unit evidence", async () => {
        const events = new MemoryProvider(host, "events", true);
        await events.prepare(
            path.join(directory, "events"),
            new Set(["alice"]),
        );
        await events.ingest([document()]);
        const appended = host.calls.find(
            (call) => call.operation === "appendEvents",
        );
        expect(appended?.conversationId).toBe("alice");
        expect(appended?.turns).toEqual([
            expect.objectContaining({
                role: "user",
                originalId: "0",
                timeSource: "turn",
            }),
        ]);
        const match = {
            event: {
                conversationId: "alice",
                content: "Tea",
                metadata: { sourceDocumentId: document().id },
            },
        };
        host.execute = async () => ({ matches: [match] });
        expect(await events.retrieve("Tea", "alice")).toHaveLength(1);
        match.event.conversationId = "bob";
        await expect(events.retrieve("Tea", "alice")).rejects.toThrow(
            "Event evidence belongs to an unknown or different unit",
        );
    });
    test("end-to-end run saves prediction, scores, exact completed counts and resource usage", async () => {
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result.state).toBe("complete");
        expect(result.accuracy).toBe(1);
        expect(result.results).toHaveLength(1);
        const progress = JSON.parse(await readFile(options.progress, "utf8"));
        expect(progress.completed).toBe(progress.total);
        expect(progress.activeQuery).toBeNull();
        expect(result.resourceUsage).toBeDefined();
        expect(host.closed).toBe(true);
    });
    test("blocked and malformed answers do not prevent later questions; resume does not retry them", async () => {
        options.stage = "qualification";
        await saveJson(options.input!, [
            {
                ...syntheticData[0],
                probing_questions: {
                    information_extraction: [
                        "Blocked",
                        "Malformed",
                        "Good",
                    ].map((question) => ({ question, rubric: ["JUDGE_ONLY"] })),
                },
            },
        ]);
        const execute = host.execute.bind(host);
        let failedCalls = 0;
        host.execute = async (request) => {
            if (request.operation === "generate") {
                const prompt = String(request.prompt);
                if (prompt.startsWith("Question: Blocked")) {
                    failedCalls++;
                    throw new BenchmarkResponseError(
                        "provider-blocked",
                        "Model response blocked by content filter",
                    );
                }
                if (prompt.startsWith("Question: Malformed")) {
                    failedCalls++;
                    throw new SyntaxError("Unexpected end of JSON input");
                }
            }
            return execute(request);
        };
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result.state).toBe("complete-with-errors");
        expect(result).toMatchObject({
            total: 3,
            completed: 3,
            scored: 1,
            blocked: 1,
            failed: 1,
            coverage: 1 / 3,
            accuracy: 1,
            correctOverTotal: 1 / 3,
            accuracyDenominator: "scored-questions",
        });
        expect(result.questionFailures.map((failure) => failure.kind)).toEqual([
            "provider-blocked",
            "invalid-response",
        ]);
        expect(result.results[0].queryId).toBe(
            "alice_information_extraction_2",
        );
        const categories = object(result.categories);
        expect(categories.information_extraction).toMatchObject({
            total: 3,
            completed: 3,
            count: 1,
            blocked: 1,
            failed: 1,
            coverage: 1 / 3,
            accuracy: 1,
        });
        const resumed = await runStage(options, { openRuntime: runtime(host) });
        expect(resumed.questionFailures).toEqual(result.questionFailures);
        expect(failedCalls).toBe(2);
        expect(host.answerCalls).toBe(1);
        const progress = JSON.parse(await readFile(options.progress, "utf8"));
        expect(progress).toMatchObject({
            state: "complete-with-errors",
            completed: 3,
            total: 3,
            scored: 1,
            blocked: 1,
            failed: 1,
            coverage: 1 / 3,
        });
    });
    test("all invalid answers finish with zero coverage and null accuracy, not a zero score", async () => {
        const execute = host.execute.bind(host);
        host.execute = async (request) =>
            request.operation === "generate"
                ? { answer: 42 }
                : execute(request);
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result).toMatchObject({
            state: "complete-with-errors",
            completed: 1,
            total: 1,
            scored: 0,
            blocked: 0,
            failed: 1,
            coverage: 0,
            accuracy: null,
            meanScore: null,
            correctOverTotal: 0,
        });
        expect(result.results).toEqual([]);
        expect(result.questionFailures[0]).toMatchObject({
            kind: "invalid-response",
            phase: "generation",
            error: "Model response has invalid answer; expected string",
        });
    });
    test("a malformed judge retains the native prediction and citations as an unscored terminal outcome", async () => {
        options.mode = "agent";
        const execute = host.execute.bind(host);
        host.execute = async (request) =>
            request.operation === "generate"
                ? { score: "bad", reason: "invalid" }
                : execute(request);
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result.questionFailures[0]).toMatchObject({
            phase: "judging",
            kind: "invalid-response",
            prediction: {
                answer: "Tea",
                nativeAnswer: { mode: "synthesized" },
            },
        });
        expect(
            result.questionFailures[0].prediction?.nativeAnswer?.citations,
        ).toHaveLength(1);
        expect(result.pendingPrediction).toBeUndefined();
        await runStage(options, { openRuntime: runtime(host) });
        expect(
            host.calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(1);
    });
    test("native provider blocking is a question outcome, not a fatal product fallback", async () => {
        options.mode = "agent";
        const execute = host.execute.bind(host);
        host.execute = async (request) => {
            if (request.operation === "answer")
                throw new Error("Model response blocked by content filter");
            return execute(request);
        };
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result).toMatchObject({
            state: "complete-with-errors",
            scored: 0,
            blocked: 1,
            failed: 0,
        });
    });
    test.each([
        { operation: "ingestBatch", error: new Error("index failed") },
        { operation: "search", error: new SyntaxError("Corrupt index JSON") },
        { operation: "generate", error: new Error("HTTP 401: unauthorized") },
    ])(
        "$operation infrastructure failure remains fatal",
        async ({ operation, error }) => {
            const execute = host.execute.bind(host);
            host.execute = async (request) => {
                if (request.operation === operation) throw error;
                return execute(request);
            };
            await expect(
                runStage(options, { openRuntime: runtime(host) }),
            ).rejects.toThrow(error.message);
            const progress = JSON.parse(
                await readFile(options.progress, "utf8"),
            );
            expect(progress.state).toBe("blocked");
            const result = JSON.parse(
                await readFile(progress.resultPath, "utf8"),
            );
            expect(result.questionFailures).toEqual([]);
        },
    );
    test("a suite advances all providers and stages despite question-level failures", async () => {
        await mkdir(options.cache, { recursive: true });
        for (const split of beamSplits) {
            const file = path.join(options.cache, `beam-${split}.json`);
            await saveJson(file, syntheticData);
            await saveJson(`${file}.provenance.json`, {
                revision:
                    beamRevisions[
                        split === "10m"
                            ? "Mohammadta/BEAM-10M"
                            : "Mohammadta/BEAM"
                    ],
                dataHash: bytesHash(await readFile(file)),
            });
        }
        const execute = host.execute.bind(host);
        host.execute = async (request) => {
            if (request.operation === "generate")
                throw new BenchmarkResponseError(
                    "provider-blocked",
                    "Model response blocked by content filter",
                );
            return execute(request);
        };
        const suiteOptions = { ...options };
        delete suiteOptions.input;
        await run(
            {
                ...suiteOptions,
                stage: "suite",
            },
            { openRuntime: runtime(host) },
        );
        const progress = JSON.parse(await readFile(options.progress, "utf8"));
        expect(Object.keys(progress.runs)).toHaveLength(48);
        expect(progress.licensing).toEqual({
            beam: "public-CC-BY-SA-4.0; attribution retained",
        });
        expect(progress.runs["beam-10m-full-events-rag"]).toMatchObject({
            state: "complete-with-errors",
            completed: 1,
            blocked: 1,
            scored: 0,
        });
    });
    test("interruption is not recorded as a question failure", async () => {
        const controller = new AbortController();
        controller.abort(new Error("Requested stop"));
        await expect(
            runStage(
                { ...options, signal: controller.signal },
                { openRuntime: runtime(host) },
            ),
        ).rejects.toThrow("Requested stop");
        const progress = JSON.parse(await readFile(options.progress, "utf8"));
        const saved = JSON.parse(await readFile(progress.resultPath, "utf8"));
        expect(saved.state).toBe("interrupted");
        expect(saved.questionFailures).toEqual([]);
    });
    test("duplicate saved question outcomes cannot inflate completion or overwrite results", async () => {
        await runStage(options, { openRuntime: runtime(host) });
        const file = path.join(
            options.output,
            "beam-100k-smoke-content-rag",
            "results.json",
        );
        const saved = JSON.parse(await readFile(file, "utf8"));
        saved.results.push(saved.results[0]);
        await saveJson(file, saved);
        const before = await readFile(file, "utf8");
        await expect(
            runStage(options, { openRuntime: runtime(host) }),
        ).rejects.toThrow(
            "Saved outcomes contain duplicate or unknown query IDs",
        );
        expect(await readFile(file, "utf8")).toBe(before);
    });
    test("judge outage persists prediction; resume does not regenerate and preserves failure history", async () => {
        host.failJudge = true;
        await expect(
            runStage(options, { openRuntime: runtime(host) }),
        ).rejects.toThrow(/judge outage/);
        expect(host.answerCalls).toBe(1);
        const file = path.join(
            options.output,
            "beam-100k-smoke-content-rag",
            "results.json",
        );
        const saved = JSON.parse(await readFile(file, "utf8"));
        const units = Object.keys(saved.ingestionSeconds);
        saved.ingestionSeconds = Object.fromEntries(
            units.map((unit) => [unit, 123]),
        );
        await saveJson(file, saved);
        host.failJudge = false;
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result.state).toBe("complete");
        expect(host.answerCalls).toBe(1);
        expect(result.error).toBeUndefined();
        expect(result.previousFailures).toHaveLength(1);
        expect(result.ingestionSeconds).toEqual(saved.ingestionSeconds);
        expect(Object.keys(result.ingestionReplaySeconds ?? {})).toEqual(units);
    });
    test("native citations survive a judge failure and prediction resume", async () => {
        options.mode = "agent";
        host.failJudge = true;
        await expect(
            runStage(options, { openRuntime: runtime(host) }),
        ).rejects.toThrow();
        host.failJudge = false;
        const result = await runStage(options, { openRuntime: runtime(host) });
        expect(result.results[0].nativeAnswer?.mode).toBe("synthesized");
        expect(
            host.calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(1);
    });
    test("fingerprint rejection does not overwrite saved successful results", async () => {
        await runStage(options, { openRuntime: runtime(host) });
        const file = path.join(
            options.output,
            "beam-100k-smoke-content-rag",
            "results.json",
        );
        const previous = await readFile(file, "utf8");
        await saveJson(options.input!, [
            { ...syntheticData[0], conversation_id: "changed" },
        ]);
        await expect(
            runStage(options, { openRuntime: runtime(host) }),
        ).rejects.toThrow(/fingerprint/);
        expect(await readFile(file, "utf8")).toBe(previous);
    });
    test("fresh progress clears another run's query, counts and scores", async () => {
        await updateProgress(options.progress, {
            activeRun: "first",
            state: "complete",
            activeQuery: "old",
            completed: 10,
            total: 10,
            accuracy: 0.8,
            scored: 8,
            blocked: 1,
            failed: 1,
            coverage: 0.8,
            diagnosis: { kind: "old" },
            lastQuestionFailure: { queryId: "old" },
        });
        await updateProgress(options.progress, {
            activeRun: "second",
            state: "indexing",
        });
        const progress = object(
            JSON.parse(await readFile(options.progress, "utf8")),
        );
        for (const key of [
            "activeQuery",
            "completed",
            "total",
            "accuracy",
            "scored",
            "blocked",
            "failed",
            "coverage",
            "diagnosis",
            "lastQuestionFailure",
        ])
            expect(progress[key]).toBeUndefined();
        expect(object(object(progress.runs).first).accuracy).toBe(0.8);
    });
    test("mode, split and suite-input gates cannot be bypassed", () => {
        expect(() =>
            validateOptions({
                ...options,
                split: "unsupported",
            }),
        ).toThrow(/split/);
        expect(() =>
            validateOptions({ ...options, provider: "events", mode: "agent" }),
        ).toThrow(/native/);
        expect(() => validateOptions({ ...options, stage: "suite" })).toThrow(
            /pinned/,
        );
    });
    test("invalid dataset JSON and malformed judges fail rather than becoming zero scores", async () => {
        await saveJson(options.input!, {});
        await expect(
            loadDataset("beam", "100k", options.cache, options.input),
        ).rejects.toThrow();
        const query = queriesFor(syntheticData)[0];
        await expect(
            judge(query, "Tea", protocol, async () => ({
                score: "bad",
                reason: "bad",
            })),
        ).rejects.toThrow(/score/);
        await expect(
            judge(query, "Tea", protocol, async () => {
                throw new Error("outage");
            }),
        ).rejects.toThrow("outage");
    });
});
