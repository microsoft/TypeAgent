// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
    nativeAnswerEvidence,
    qmsumReferences,
    runNativeAnswers,
    type NativeAnswerOptions,
} from "../src/chunkingBench/nativeAnswers.js";
import { adaptQmsum, validateDataset } from "../src/chunkingBench/datasets.js";
import { nativeCandidate } from "../src/chunkingBench/retrievers.js";
import {
    bytesHash,
    digest,
    object,
    saveJson,
} from "../src/memoryBench/storage.js";
import type { Runtime } from "../src/memoryBench/types.js";
import { BenchmarkResponseError } from "@typeagent/memory-service/benchmark";
import { chunkingTestWorkspace } from "./chunkingTestWorkspace.js";

const raw =
    JSON.stringify({
        meeting_transcripts: [
            {
                speaker: "Speaker",
                content: "Background ".repeat(3000) + "Capacity will grow.",
            },
        ],
        specific_query_list: [
            {
                query: "Will capacity grow?",
                answer: "Yes, capacity will grow.",
                relevant_text_span: [["0", "0"]],
            },
        ],
        general_query_list: [],
    }) + "\n";
const adapted = adaptQmsum(raw);
const dataset = validateDataset({
    ...adapted,
    version: "chunking-span-v1",
    protocol: "independent-not-article-parity",
    coordinateSpace: "utf16-code-point-boundaries",
    dataset: "qmsum",
    split: "synthetic",
    provenance: [{ source: "synthetic", sha256: bytesHash(raw) }],
});
const document = dataset.documents[0];
const source = {
    sourceId: "source",
    revisionId: "revision",
    contentHash: bytesHash(document.text),
    totalChars: document.text.length,
    blocks: [
        {
            start: 0,
            end: document.text.length,
            sha256: bytesHash(document.text),
        },
    ],
};
const manifest = {
    datasetHash: digest(dataset),
    questionIds: [dataset.questions[0].id],
};
const state = {
    fingerprint: digest(manifest),
    corpusId: "corpus",
    ready: true,
    configurationFingerprint: "config",
    sources: { [document.id]: source },
};
const evidence = {
    sourceId: source.sourceId,
    revisionId: source.revisionId,
    corpusId: state.corpusId,
    snippet: document.text,
    score: 1,
    locator: `indexed:0:${source.contentHash}:0-${document.text.length}`,
};
const response = {
    question: dataset.questions[0].text,
    answer: "Yes, capacity will grow.",
    mode: "synthesized",
    grounded: true,
    warnings: [],
    citations: [evidence],
    readerContext: {
        answerPath: "sources-and-views",
        serializedContextChars: document.text.length,
        integratedAnswer: {
            suppliedEvidence: [{ kind: "source", source: evidence }],
        },
    },
};
const grade = {
    verdict: "correct",
    correctness: 1,
    completeness: 1,
    grounding: 1,
    reason: "The answer is supported.",
};

describe("native answer baseline", () => {
    let root: string;
    let options: NativeAnswerOptions;
    let calls: Record<string, unknown>[];
    let closed: number;
    let blockJudge: boolean;
    let answerError: Error | undefined;
    let config: string;
    const open = async (): Promise<Runtime> => ({
        bridge: {
            execute: async (request) => {
                calls.push(request);
                switch (request.operation) {
                    case "capabilities":
                        return {
                            benchmark: {
                                configurationFingerprint: config,
                                modelId: "synthetic:judge",
                                nativeAnswerModelId: "synthetic:reader",
                            },
                        };
                    case "inspect":
                        return {
                            sourceCount: 1,
                            readyRevisionCount: 1,
                            activeJobCount: 0,
                        };
                    case "retrievalSource":
                        return source;
                    case "answer":
                        if (answerError) throw answerError;
                        return response;
                    case "generate":
                        if (blockJudge)
                            throw new BenchmarkResponseError(
                                "provider-blocked",
                                "Synthetic filtering",
                            );
                        return grade;
                    default:
                        throw new Error(
                            `Unexpected operation: ${String(request.operation)}`,
                        );
                }
            },
        },
        close: async () => {
            closed++;
        },
    });

    beforeEach(async () => {
        const workspace = await chunkingTestWorkspace("native-answer-");
        root = workspace.root;
        options = {
            retrievalRun: path.join(root, "retrieval"),
            output: path.join(root, "answers"),
            references: path.join(root, "references.jsonl"),
            repo: workspace.repo,
        };
        await saveJson(
            path.join(options.retrievalRun, "dataset.json"),
            dataset,
        );
        await saveJson(
            path.join(options.retrievalRun, "manifest.json"),
            manifest,
        );
        await saveJson(
            path.join(options.retrievalRun, "native-state.json"),
            state,
        );
        const { writeFile } = await import("node:fs/promises");
        await writeFile(options.references, raw);
        calls = [];
        closed = 0;
        blockJudge = false;
        answerError = undefined;
        config = "config";
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test("keeps references evaluator-only, maps actual evidence and does not truncate at 2000 tokens", async () => {
        const result = await runNativeAnswers(options, open);
        expect(result.summary).toMatchObject({
            selected: 1,
            scored: 1,
            correct: 1,
            failed: 0,
            allReaderSpanRecall: 1,
        });
        expect(
            result.rows[0].evidence!.allReaderSources.context.tokens,
        ).toBeGreaterThan(2000);
        expect(calls.find((call) => call.operation === "answer")).toEqual({
            operation: "answer",
            corpusId: "corpus",
            question: "Will capacity grow?",
            includeDiagnostics: true,
        });
        expect(calls.some((call) => call.operation === "ingest")).toBe(false);
        expect(
            String(calls.find((call) => call.operation === "generate")!.prompt),
        ).toContain("Yes, capacity will grow.");
        expect(result.corpusVerifiedBeforeAndAfter).toBe(true);
        expect(closed).toBe(1);
        const file = path.join(
            options.output,
            "receipts",
            `${bytesHash(dataset.questions[0].id)}.json`,
        );
        const before = await readFile(file);
        const again = await runNativeAnswers(options, open);
        expect(again.summary).toEqual(result.summary);
        expect(await readFile(file)).toEqual(before);
        expect(
            calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(1);
        expect(
            calls.filter((call) => call.operation === "generate"),
        ).toHaveLength(1);
    });

    test("preserves the answer when grading is blocked and resumes grading only", async () => {
        blockJudge = true;
        expect((await runNativeAnswers(options, open)).summary).toMatchObject({
            scored: 0,
            failed: 1,
        });
        blockJudge = false;
        expect((await runNativeAnswers(options, open)).summary).toMatchObject({
            scored: 1,
            failed: 0,
        });
        expect(
            calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(1);
        expect(
            calls.filter((call) => call.operation === "generate"),
        ).toHaveLength(2);
    });

    test.each([undefined, null])(
        "rejects a missing saved response without regenerating legacy receipts (%p)",
        async (response) => {
            await runNativeAnswers(options, open);
            const file = path.join(
                options.output,
                "receipts",
                `${bytesHash(dataset.questions[0].id)}.json`,
            );
            await saveJson(file, {
                ...object(JSON.parse(await readFile(file, "utf8"))),
                response,
            });
            await rm(`${file}.attempt.json`);
            const before = await readFile(file);
            await expect(runNativeAnswers(options, open)).rejects.toThrow(
                "Saved answer receipt has no native response",
            );
            expect(await readFile(file)).toEqual(before);
            expect(
                calls.filter((call) => call.operation === "answer"),
            ).toHaveLength(1);
            expect(
                calls.filter((call) => call.operation === "generate"),
            ).toHaveLength(1);
        },
    );

    test.each([
        new Error("Synthetic answer failure"),
        new BenchmarkResponseError(
            "provider-blocked",
            "Synthetic answer failure",
        ),
    ])(
        "records a failed answer attempt and never regenerates it (%s)",
        async (error) => {
            answerError = error;
            await expect(runNativeAnswers(options, open)).rejects.toThrow(
                "Synthetic answer failure",
            );
            const attemptFile = path.join(
                options.output,
                "receipts",
                `${bytesHash(dataset.questions[0].id)}.json.attempt.json`,
            );
            const before = await readFile(attemptFile);
            expect(JSON.parse(before.toString())).toMatchObject({
                questionId: dataset.questions[0].id,
                state: "answer-attempted",
            });
            answerError = undefined;
            await expect(runNativeAnswers(options, open)).rejects.toThrow(
                "already attempted",
            );
            expect(await readFile(attemptFile)).toEqual(before);
            expect(
                calls.filter((call) => call.operation === "answer"),
            ).toHaveLength(1);
            expect(calls.some((call) => call.operation === "generate")).toBe(
                false,
            );
        },
    );

    test("rejects mismatched reference provenance before opening the provider", async () => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(options.references, raw + "\n");
        await expect(runNativeAnswers(options, open)).rejects.toThrow(
            "provenance",
        );
        expect(calls).toHaveLength(0);
    });

    test("rejects a changed native configuration and closes the runtime", async () => {
        config = "changed";
        await expect(runNativeAnswers(options, open)).rejects.toThrow(
            "configuration differs",
        );
        expect(closed).toBe(1);
        expect(calls.some((call) => call.operation === "answer")).toBe(false);
    });

    test("rejects output within the original retrieval run or checkout", async () => {
        await expect(
            runNativeAnswers(
                { ...options, output: options.retrievalRun },
                open,
            ),
        ).rejects.toThrow("source retrieval run");
        await expect(
            runNativeAnswers(
                { ...options, output: path.join(options.repo, "answers") },
                open,
            ),
        ).rejects.toThrow("source checkout");
    });

    test("separates initial/refined reader sources from final citations", () => {
        const emptyFinal = {
            ...response,
            citations: [],
            readerContext: {
                ...response.readerContext,
                integratedAnswer: {
                    suppliedEvidence: [],
                    refinement: {
                        queries: ["capacity"],
                        initialEvidence: [{ kind: "source", source: evidence }],
                    },
                },
            },
        };
        const measured = nativeAnswerEvidence(
            emptyFinal,
            dataset,
            state,
            dataset.questions[0].gold,
        );
        expect(measured.finalSources.metrics.recall).toBe(0);
        expect(measured.allReaderSources.metrics.recall).toBe(1);
        expect(measured.citations.metrics.recall).toBe(0);
        expect(measured.refinementQueries).toEqual(["capacity"]);
    });

    test("rejects missing integrated diagnostics and source/corpus escapes", () => {
        expect(() =>
            nativeAnswerEvidence(
                { ...response, readerContext: undefined },
                dataset,
                state,
                dataset.questions[0].gold,
            ),
        ).toThrow();
        const escaped = {
            ...response,
            citations: [{ ...evidence, corpusId: "other" }],
        };
        expect(() =>
            nativeAnswerEvidence(
                escaped,
                dataset,
                state,
                dataset.questions[0].gold,
            ),
        ).toThrow("escaped");
        expect(() =>
            nativeCandidate(
                {
                    ...evidence,
                    locator: "chars:0-7",
                    snippet: document.text.slice(0, 7),
                },
                document,
                source,
            ),
        ).not.toThrow();
        expect(() =>
            nativeCandidate(
                { ...evidence, locator: "chars:0-999999" },
                document,
                source,
            ),
        ).toThrow();
    });

    test("rejects wrong or incomplete reference questions", () => {
        expect(qmsumReferences(raw, dataset).get(dataset.questions[0].id)).toBe(
            "Yes, capacity will grow.",
        );
        expect(() =>
            qmsumReferences(
                raw.replace("Will capacity grow?", "Wrong question"),
                dataset,
            ),
        ).toThrow("mismatch");
        const meeting = object(JSON.parse(raw));
        expect(() =>
            qmsumReferences(
                JSON.stringify({ ...meeting, specific_query_list: [] }),
                dataset,
            ),
        ).toThrow("cover");
    });
});
