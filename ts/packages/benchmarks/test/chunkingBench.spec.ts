// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkingTestWorkspace } from "./chunkingTestWorkspace.js";
import {
    adaptLegalBench,
    adaptQasper,
    adaptQmsum,
    validateDataset,
    validateSpan,
} from "../src/chunkingBench/datasets.js";
import {
    boundedPrefix,
    candidateText,
    chunkDocuments,
    mergeSpans,
    packContext,
    scoreContext,
    tokens,
} from "../src/chunkingBench/scoring.js";
import {
    lexicalRetriever,
    nativeCandidate,
    reciprocalRankFusion,
} from "../src/chunkingBench/retrievers.js";
import { runBenchmark, type RunOptions } from "../src/chunkingBench/runner.js";
import { bytesHash, readJson, saveJson } from "../src/memoryBench/storage.js";
import { bm25Scores, createBm25Scorer } from "../src/memoryBench/scoring.js";
import type { Dataset, Document } from "../src/chunkingBench/types.js";
import type { Runtime } from "../src/memoryBench/types.js";

const doc: Document = {
    id: "doc",
    title: "Synthetic evidence",
    text: "Alpha 😀 beta. Gamma delta.\n\nSecond paragraph.",
    sections: [],
};
const documents = new Map([[doc.id, doc]]);
const span = (start: number, end: number) => ({
    documentId: doc.id,
    start,
    end,
});
const candidate = (start: number, end: number, header = "") => ({
    ...span(start, end),
    id: `doc:${start}-${end}`,
    score: 1,
    header,
});

describe("chunking evidence metrics and token budgets", () => {
    test("measures Unicode code points and merges duplicate/overlapping source intervals", () => {
        const context = packContext(
            [candidate(0, 13), candidate(0, 13)],
            documents,
            100,
        );
        const score = scoreContext(
            [span(0, 8), span(6, 8)],
            context,
            documents,
        );
        expect(score.goldCharacters).toBe(7);
        expect(score.relevantCharacters).toBe(7);
        expect(score.recall).toBe(1);
        expect(score.retrievedCharacters).toBe(12);
        expect(score.precision).toBeCloseTo(7 / 12);
        expect(score.duplicateFraction).toBe(0.5);
        expect(score.contextPrecision).toBeLessThan(score.precision);
        expect(mergeSpans([span(4, 8), span(0, 6)])).toEqual([span(0, 8)]);
    });

    test("counts headers and separators, clips only the tail, and never splits a surrogate", () => {
        for (const budget of [1, 2, 4, 8, 12, 20]) {
            const packed = packContext(
                [candidate(0, doc.text.length, "Document identity")],
                documents,
                budget,
            );
            expect(tokens(packed.text)).toBeLessThanOrEqual(budget);
            expect(packed.tokens).toBe(tokens(packed.text));
            expect(packed.text).not.toMatch(/[\uD800-\uDBFF]$/u);
            for (const range of packed.spans) validateSpan(range, documents);
        }
        const packed = packContext(
            [candidate(0, 8, "LONG HEADER ".repeat(20))],
            documents,
            5,
        );
        expect(packed.spans).toHaveLength(0);
        expect(scoreContext([span(0, 8)], packed, documents).recall).toBe(0);
    });

    test("empty retrieval is a scored zero, but invalid evidence and gold-empty inputs fail", () => {
        expect(
            scoreContext(
                [span(0, 8)],
                packContext([], documents, 2000),
                documents,
            ),
        ).toMatchObject({
            recall: 0,
            precision: 0,
            contextPrecision: 0,
        });
        expect(() => validateSpan(span(0, 7), documents)).toThrow("Unicode");
        expect(() => validateSpan(span(-1, 8), documents)).toThrow();
        expect(() =>
            scoreContext([], packContext([], documents, 10), documents),
        ).toThrow("answerability");
        expect(() => packContext([], documents, 0)).toThrow("budget");
    });

    test.each(["fixed", "sentence", "paragraph", "structure"] as const)(
        "lossless %s chunks respect measured bounds",
        (strategy) => {
            const source = { ...doc, text: doc.text.repeat(20) };
            const chunks = chunkDocuments([source], 17, 0, strategy);
            expect(
                chunks
                    .map((item) => source.text.slice(item.start, item.end))
                    .join(""),
            ).toBe(source.text);
            expect(
                chunks.every(
                    (item) =>
                        tokens(source.text.slice(item.start, item.end)) <= 17,
                ),
            ).toBe(true);
            expect(chunks.every((item) => item.end > item.start)).toBe(true);
        },
    );

    test("overlap preserves complete coverage, and whole-document controls are not truncated", () => {
        const source = { ...doc, text: doc.text.repeat(10) };
        const chunks = chunkDocuments([source], 20, 6);
        expect(mergeSpans(chunks)).toEqual([
            { documentId: "doc", start: 0, end: source.text.length },
        ]);
        expect(chunks[1].start).toBeLessThan(chunks[0].end);
        expect(chunkDocuments([source], 20, 0, "whole")).toHaveLength(1);
        expect(() => chunkDocuments([source], 20, 20)).toThrow("overlap");
        expect(boundedPrefix("😀", (value) => tokens(value) <= 1)).toBe(0);
    });
});

describe("canonical dataset adapters and annotation separation", () => {
    test("Qasper chooses a fully mapped annotation and excludes ambiguous/unanswerable evidence", () => {
        const raw = {
            paper: {
                title: "Paper title",
                abstract: "Abstract.",
                full_text: [
                    {
                        section_name: "Methods",
                        paragraphs: [
                            "Evidence 😀 paragraph.",
                            "Repeated.",
                            "Repeated.",
                        ],
                    },
                    { section_name: null, paragraphs: ["Unnamed section."] },
                ],
                qas: [
                    {
                        question_id: "one",
                        question: "QUERY_NOT_CONTENT",
                        answers: [
                            {
                                answer: {
                                    unanswerable: false,
                                    evidence: ["Missing table"],
                                },
                            },
                            {
                                answer: {
                                    unanswerable: false,
                                    evidence: ["Evidence 😀 paragraph."],
                                    free_form_answer: "ANSWER_NOT_CONTENT",
                                },
                            },
                        ],
                    },
                    {
                        question_id: "two",
                        question: "Unknown",
                        answers: [
                            { answer: { unanswerable: true, evidence: [] } },
                        ],
                    },
                    {
                        question_id: "three",
                        question: "Ambiguous",
                        answers: [
                            {
                                answer: {
                                    unanswerable: false,
                                    evidence: ["Repeated."],
                                },
                            },
                        ],
                    },
                ],
            },
        };
        const adapted = adaptQasper(raw);
        expect(adapted.questions).toHaveLength(1);
        expect(adapted.exclusions).toHaveLength(2);
        expect(adapted.documents[0].text).not.toContain("QUERY_NOT_CONTENT");
        expect(adapted.documents[0].text).not.toContain("ANSWER_NOT_CONTENT");
        expect(adapted.documents[0].text).toContain("Unnamed section.");
        const range = adapted.questions[0].gold[0];
        expect(adapted.documents[0].text.slice(range.start, range.end)).toBe(
            "Evidence 😀 paragraph.",
        );
    });

    test("QMSum maps inclusive utterances and excludes topics, answers and general queries", () => {
        const adapted = adaptQmsum(
            JSON.stringify({
                topic_list: [{ topic: "GOLD_TOPIC" }],
                meeting_transcripts: [
                    { speaker: "A", content: "First 😀" },
                    { speaker: "B", content: "Second" },
                ],
                specific_query_list: [
                    {
                        query: "QUERY",
                        answer: "GOLD_ANSWER",
                        relevant_text_span: [["0", "1"]],
                    },
                ],
                general_query_list: [
                    { query: "Summarize", answer: "GOLD_GENERAL" },
                ],
            }),
        );
        const source = adapted.documents[0];
        expect(source.text).toBe("A: First 😀\nB: Second\n");
        expect(JSON.stringify(source)).not.toMatch(/GOLD|QUERY/u);
        expect(adapted.questions[0].gold).toEqual([
            { documentId: source.id, start: 0, end: source.text.length - 1 },
        ]);
        expect(adapted.exclusions).toHaveLength(1);
    });

    test("LegalBench converts Python code points and reads the full pool, not only gold files", async () => {
        const { root } = await chunkingTestWorkspace("chunk-legal-");
        try {
            await mkdir(path.join(root, "corpus"));
            await mkdir(path.join(root, "benchmarks"));
            await writeFile(path.join(root, "corpus", "one.txt"), "A😀BC");
            await writeFile(
                path.join(root, "corpus", "distractor.txt"),
                "Unrelated",
            );
            await saveJson(path.join(root, "benchmarks", "test.json"), {
                tests: [
                    {
                        query: "Which?",
                        snippets: [{ file_path: "one.txt", span: [1, 3] }],
                    },
                ],
            });
            const adapted = await adaptLegalBench(root);
            expect(adapted.documents).toHaveLength(2);
            expect(adapted.questions[0].gold).toEqual([
                { documentId: "one.txt", start: 1, end: 4 },
            ]);
            expect(adapted.hashes).toHaveLength(3);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe("retrieval baselines and native anchors", () => {
    test("precomputed BM25 preserves the existing scorer and stable full-pool ranking", () => {
        const texts = ["rare keyword", "common common", "common"];
        const score = createBm25Scorer(texts);
        expect(score("rare common")).toEqual(bm25Scores(texts, "rare common"));
        const third = { ...doc, id: "third", text: "Additional background." };
        const chunks = chunkDocuments(
            [doc, { ...doc, id: "other", text: "unique saffron" }, third],
            512,
        );
        const rank = lexicalRetriever(
            chunks,
            new Map([
                [doc.id, doc],
                ["other", { ...doc, id: "other", text: "unique saffron" }],
                ["third", third],
            ]),
        );
        expect(rank("saffron")[0].documentId).toBe("other");
        expect(rank("absent")).toEqual(rank("absent"));
    });

    test("RRF fuses ranks, rejects collisions and does not add raw scores", () => {
        const first = candidate(0, 8),
            second = candidate(9, 13);
        const fused = reciprocalRankFusion([[first, second], [second]], 20);
        expect(fused[0].id).toBe(second.id);
        expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61);
        expect(() => reciprocalRankFusion([[first, first]], 20)).toThrow(
            "Duplicate",
        );
    });

    test("native block hashes and offsets round-trip; stale, ambiguous or forged anchors fail", () => {
        const source = {
            sourceId: "source",
            revisionId: "r1",
            totalChars: doc.text.length,
            contentHash: bytesHash(doc.text),
            blocks: [
                { start: 0, end: doc.text.length, sha256: bytesHash(doc.text) },
            ],
        };
        const value = {
            sourceId: "source",
            revisionId: "r1",
            score: 2,
            snippet: doc.text.slice(0, 8),
            locator: `indexed:0:${bytesHash(doc.text)}:0-8`,
        };
        expect(nativeCandidate(value, doc, source)).toMatchObject({
            start: 0,
            end: 8,
            documentId: "doc",
        });
        expect(() =>
            nativeCandidate({ ...value, snippet: "FORGED" }, doc, source),
        ).toThrow("exact source");
        expect(() =>
            nativeCandidate({ ...value, revisionId: "stale" }, doc, source),
        ).toThrow("fingerprint");
        expect(() =>
            nativeCandidate({ ...value, locator: "message:1" }, doc, source),
        ).toThrow("ambiguous or missing");
        expect(candidateText(candidate(0, 8), documents)).toBe(
            doc.text.slice(0, 8),
        );
    });
});

const synthetic: Dataset = {
    version: "chunking-span-v1",
    protocol: "independent-not-article-parity",
    coordinateSpace: "utf16-code-point-boundaries",
    dataset: "qmsum",
    split: "synthetic",
    provenance: [{ source: "synthetic", sha256: bytesHash("synthetic") }],
    annotationPolicy: "synthetic-only",
    documents: [
        doc,
        { ...doc, id: "distractor", text: "Irrelevant background." },
    ],
    questions: [
        { id: "q1", text: "Alpha", groupId: "doc", gold: [span(0, 8)] },
    ],
    exclusions: [],
};

describe("persistent chunking benchmark execution", () => {
    let root: string;
    let options: RunOptions;
    beforeEach(async () => {
        const workspace = await chunkingTestWorkspace("chunk-run-");
        root = workspace.root;
        const input = path.join(root, "dataset.json");
        await saveJson(input, synthetic);
        options = {
            input,
            output: path.join(root, "run"),
            repo: workspace.repo,
            arms: ["bm25"],
            budget: 2000,
            size: 512,
            overlap: 0,
            strategy: "fixed",
            headers: false,
            questions: 10,
            candidateLimit: 200,
            embeddingTokenLimit: 0,
        };
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test("runs offline, resumes, and rejects changed protocol/data without overwriting receipts", async () => {
        const first = await runBenchmark(options);
        expect(first.rows[0].metrics?.recall).toBe(1);
        expect(first.summary[0].coverage).toBe(1);
        const second = await runBenchmark(options);
        expect(second.rows).toEqual(first.rows);
        await expect(
            runBenchmark({ ...options, budget: 1000 }),
        ).rejects.toThrow("fingerprint mismatch");
        expect(
            await readJson(path.join(options.output, "status.json")),
        ).toMatchObject({ state: "complete" });
        expect(
            validateDataset(await readJson(options.input)).documents,
        ).toHaveLength(2);
    });

    test("native smoke imports the entire pool and reopens before query; mapping failures are not zero recall", async () => {
        const imported = new Map<string, { content: string; title: string }>();
        let opened = 0,
            closed = 0,
            queried = 0;
        const openRuntime = async (): Promise<Runtime> => {
            opened++;
            return {
                close: async () => {
                    closed++;
                },
                bridge: {
                    execute: async (request) => {
                        switch (request.operation) {
                            case "capabilities":
                                return {
                                    benchmark: {
                                        configurationFingerprint: "offline",
                                    },
                                };
                            case "createCorpus":
                                return { corpusId: "owned-corpus" };
                            case "ingest":
                                imported.set(String(request.sourceId), {
                                    content: String(request.content),
                                    title: String(request.title),
                                });
                                return { state: "complete" };
                            case "retrievalSource": {
                                const source = imported.get(
                                    String(request.sourceId),
                                )!;
                                return {
                                    sourceId: request.sourceId,
                                    revisionId: "r1",
                                    contentHash: bytesHash(source.content),
                                    totalChars: source.content.length,
                                    blocks: [
                                        {
                                            start: 0,
                                            end: source.content.length,
                                            sha256: bytesHash(source.content),
                                        },
                                    ],
                                };
                            }
                            case "inspect":
                                return {
                                    sourceCount: imported.size,
                                    readyRevisionCount: imported.size,
                                    activeJobCount: 0,
                                };
                            case "retrievalSearch": {
                                queried++;
                                expect(opened).toBe(2);
                                expect(imported.size).toBe(2);
                                const [sourceId, source] = [...imported][0];
                                return {
                                    matches: [
                                        {
                                            sourceId,
                                            revisionId: "r1",
                                            score: 1,
                                            snippet: "FORGED",
                                            locator: `indexed:0:${bytesHash(source.content)}:0-8`,
                                        },
                                    ],
                                };
                            }
                            default:
                                throw new Error(
                                    `Unexpected operation: ${String(request.operation)}`,
                                );
                        }
                    },
                },
            };
        };
        const result = await runBenchmark(
            { ...options, arms: ["indexed"] },
            { openRuntime },
        );
        expect(queried).toBe(1);
        expect(closed).toBe(2);
        expect(result.rows[0]).toMatchObject({
            state: "failed",
            metrics: null,
        });
        expect(result.summary[0]).toMatchObject({
            failed: 1,
            coverage: 0,
            macroRecall: null,
            failureInclusiveRecall: 0,
        });
        expect(
            await readJson(path.join(options.output, "status.json")),
        ).toMatchObject({ state: "complete-with-failures" });
    });

    test("an interrupted run persists an explicit non-success state", async () => {
        const controller = new AbortController();
        controller.abort(new Error("stop"));
        await expect(
            runBenchmark({ ...options, signal: controller.signal }),
        ).rejects.toThrow("stop");
        expect(
            JSON.parse(
                await readFile(
                    path.join(options.output, "status.json"),
                    "utf8",
                ),
            ),
        ).toMatchObject({ state: "interrupted" });
    });
});
