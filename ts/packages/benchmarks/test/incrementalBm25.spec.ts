// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
    IndexedBlock,
    IndexedWindowCandidate,
} from "@typeagent/memory-service/benchmark";
import { bm25Scores, createBm25Scorer } from "../src/memoryBench/scoring.js";
import {
    bytesHash,
    digest,
    object,
    saveJson,
} from "../src/memoryBench/storage.js";
import type { Runtime } from "../src/memoryBench/types.js";
import { adaptQmsum, validateDataset } from "../src/chunkingBench/datasets.js";
import {
    createIncrementalController,
    observableGate,
    type NativeArm,
} from "../src/chunkingBench/incrementalPolicy.js";
import {
    analyzeIncremental,
    pairedSummary,
} from "../src/chunkingBench/incrementalAnalysis.js";
import {
    runIncremental as runExperiment,
    type IncrementalOptions,
} from "../src/chunkingBench/incrementalRunner.js";
import {
    beamSnapshot,
    cloneFrozenStore,
    treeIdentity,
} from "../src/chunkingBench/incrementalSnapshots.js";
import type { SourceMap } from "../src/chunkingBench/retrievers.js";
import { protocol, syntheticData } from "./memoryBenchFixtures.js";
import {
    verifyPersistedEmbeddingIdentities,
    verifyPersistedRawSourceMaps,
} from "../src/chunkingBench/incrementalCompatibility.js";
import type { EmbeddingIdentity } from "@typeagent/aiclient";

const runIncremental = (
    options: IncrementalOptions,
    open: Parameters<typeof runExperiment>[1],
) =>
    runExperiment(
        options,
        open,
        async () => ({
            fixture: "offline embedding parity proven",
        }),
        async () => ({
            originalDocPartsVerified: true,
            sourceMapsDigest: "fixture",
            sources: 1,
        }),
    );

const block = (
    text: string,
    blockOrdinal: number,
    score = 1,
): IndexedBlock => ({
    sourceId: "source",
    revisionId: "revision",
    text,
    blockOrdinal,
    score,
});
const eligible = [
    block("common native words", 0, 9),
    block("quasar operand", 1, 0),
    block("other unrelated words", 2, 0),
];
const source: SourceMap = {
    sourceId: "source",
    revisionId: "revision",
    contentHash: "unused",
    totalChars: 100,
    blocks: eligible.map((b) => ({
        start: 0,
        end: b.text.length,
        sha256: bytesHash(b.text),
    })),
};
const request = { sourceIds: ["source"], query: "quasar", terms: ["quasar"] };

function controller(arm: NativeArm) {
    const c = createIncrementalController("corpus", [source], { arm });
    return { ...c, policy: c.policyFor("corpus")! };
}

describe("raw native BM25 controller", () => {
    test("N0 observes without changing native block objects, scores or windows", () => {
        const c = controller("N0");
        const native = [eligible[0], eligible[1]];
        const result = c.policy.selectBlocks!({
            request,
            eligibleBlocks: eligible,
            nativeBlocks: native,
        });
        expect(result).toEqual(native);
        expect(result[0]).toBe(native[0]);
        const windows = [
            { block: native[0], offset: 0 },
            { block: native[1], offset: 0 },
        ];
        const ranked = c.policy.rankWindows!({
            request,
            windows,
            windowChars: 8,
        });
        expect(ranked).toEqual(windows);
        expect(ranked[0]).toBe(windows[0]);
        expect(c.drain()).toHaveLength(2);
        expect(c.drain()).toEqual([]);
    });

    test("N1 only reranks native pool using ALL eligible raw block statistics", () => {
        const c = controller("N1");
        const native = [eligible[0], eligible[1]];
        const ranked = c.policy.selectBlocks!({
            request,
            eligibleBlocks: eligible,
            nativeBlocks: native,
        });
        expect(ranked.map((b) => b.blockOrdinal)).toEqual([1, 0]);
        const scorer = createBm25Scorer(eligible.map((b) => b.text));
        expect(ranked[0].score).toBe(scorer("quasar")[1]);
        expect(ranked).toHaveLength(native.length);
    });

    test("N2 reorders EXACT existing window objects against fixed DocPart statistics", () => {
        const c = controller("N2");
        const native = [eligible[0], eligible[1]];
        expect(
            c.policy.selectBlocks!({
                request,
                eligibleBlocks: eligible,
                nativeBlocks: native,
            }),
        ).toEqual(native);
        const windows: IndexedWindowCandidate[] = [
            { block: eligible[0], offset: 0 },
            { block: eligible[1], offset: 0, matched: true },
            { block: eligible[1], offset: 7 },
        ];
        const ranked = c.policy.rankWindows!({
            request,
            windows,
            windowChars: 6,
        });
        expect(ranked[0]).toBe(windows[1]);
        expect(new Set(ranked)).toEqual(new Set(windows));
        expect(windows.map((w) => w.offset)).toEqual([0, 0, 7]);
        expect(c.drain()[1].normalization).toContain("fixed-raw-DocPart");
    });

    test("N3 fuses matching lexical union with native rank at k=60 and deduplicates", () => {
        const c = controller("N3");
        const ranked = c.policy.selectBlocks!({
            request,
            eligibleBlocks: eligible,
            nativeBlocks: [eligible[0]],
        });
        expect(ranked.map((b) => b.blockOrdinal)).toEqual([0, 1]);
        expect(ranked[1].score).toBe(1 / 61);
        expect(ranked.some((b) => b.blockOrdinal === 2)).toBe(false);
        const shared = c.policy.selectBlocks!({
            request,
            eligibleBlocks: eligible,
            nativeBlocks: [eligible[1]],
        });
        expect(shared).toHaveLength(1);
        expect(shared[0].score).toBe(2 / 61);
    });

    test("N3 uses native scores rather than storage order, preserving tied order and input blocks", () => {
        const c = controller("N3");
        const native = [
            { ...eligible[0], score: 1 },
            { ...eligible[2], score: 100 },
            { ...eligible[1], score: 1 },
        ];
        const ranked = c.policy.selectBlocks!({
            request,
            eligibleBlocks: eligible,
            nativeBlocks: native,
        });
        const scores = new Map(ranked.map((b) => [b.blockOrdinal, b.score]));
        expect(scores.get(2)).toBe(1 / 61);
        expect(scores.get(0)).toBe(1 / 62);
        expect(scores.get(1)).toBe(1 / 63 + 1 / 61);
        expect(native.map((b) => b.blockOrdinal)).toEqual([0, 2, 1]);
        expect(native.map((b) => b.score)).toEqual([1, 100, 1]);
    });

    test("N3 has no arbitrary lexical candidates for an unmatched query, including empty native pool", () => {
        const c = controller("N3");
        const unmatched = { ...request, query: "missing", terms: ["missing"] };
        expect(
            c.policy.selectBlocks!({
                request: unmatched,
                eligibleBlocks: eligible,
                nativeBlocks: [],
            }),
        ).toEqual([]);
        const original = [eligible[0]];
        expect(
            c.policy.selectBlocks!({
                request: unmatched,
                eligibleBlocks: eligible,
                nativeBlocks: original,
            }),
        ).toEqual(original);
    });

    test("foreign corpora, source IDs, changed raw text, revisions and derived indexes stay untouched", () => {
        const c = controller("N3");
        expect(c.policyFor("foreign")).toBeUndefined();
        for (const foreign of [
            { ...eligible[0], sourceId: "derived" },
            { ...eligible[0], revisionId: "old" },
            { ...eligible[0], text: "mutated quasar" },
        ]) {
            const result = c.policy.selectBlocks!({
                request,
                eligibleBlocks: [foreign],
                nativeBlocks: [foreign],
            });
            expect(result[0]).toBe(foreign);
        }
        expect(c.drain()).toEqual([]);
    });

    test("independent empty and explicit-term-coverage gates never inspect labels or evaluator inputs", () => {
        expect(observableGate("quasar operand", [eligible[0]])).toMatchObject({
            empty: false,
            "term-coverage": true,
            coverage: 0,
        });
        expect(observableGate("quasar operand", [eligible[1]])).toMatchObject({
            empty: false,
            "term-coverage": false,
            coverage: 1,
        });
        expect(
            observableGate("quasar common", [eligible[0]])["term-coverage"],
        ).toBe(false);
        expect(observableGate("", []).coverage).toBe(1);
        for (const gate of ["empty", "term-coverage"] as const) {
            const c = createIncrementalController("corpus", [source], {
                arm: "N4",
                gate,
                intervention: "N3",
            });
            const policy = c.policyFor("corpus")!;
            const result = policy.selectBlocks!({
                request,
                eligibleBlocks: eligible,
                nativeBlocks: [eligible[0]],
            });
            expect(result).toHaveLength(gate === "empty" ? 1 : 2);
            expect(JSON.stringify(c.drain())).not.toMatch(
                /reference|correctness|gold/i,
            );
        }
    });

    test("fixed-statistics window API retains exact legacy BM25 scores", () => {
        const docs = ["cat cat dog", "dog", "bird nest"];
        const scorer = createBm25Scorer(docs);
        expect(scorer("cat cat")).toEqual(bm25Scores(docs, "cat cat"));
        expect(scorer.scoreTexts("cat cat", docs)).toEqual(scorer("cat cat"));
        expect(scorer.scoreTexts("absent", ["absent"])).toEqual([0]);
        expect(scorer("cat")[0]).toBeCloseTo(0.6287084600196808, 12);
    });
});

describe("paired native runner offline", () => {
    let root: string;
    let options: IncrementalOptions;
    let calls: Record<string, unknown>[];
    let failJudge: boolean;
    let config: string;
    const raw =
        JSON.stringify({
            meeting_transcripts: [
                { speaker: "speaker", content: "Capacity will grow." },
            ],
            specific_query_list: [
                {
                    query: "Will capacity grow?",
                    answer: "Yes.",
                    relevant_text_span: [["0", "0"]],
                },
            ],
            general_query_list: [],
        }) + "\n";
    const dataset = validateDataset({
        ...adaptQmsum(raw),
        version: "chunking-span-v1",
        protocol: "independent-not-article-parity",
        coordinateSpace: "utf16-code-point-boundaries",
        dataset: "qmsum",
        split: "synthetic",
        provenance: [{ source: "synthetic", sha256: bytesHash(raw) }],
    });
    const doc = dataset.documents[0];
    const map = {
        sourceId: "source",
        revisionId: "revision",
        contentHash: bytesHash(doc.text),
        totalChars: doc.text.length,
        blocks: [
            { start: 0, end: doc.text.length, sha256: bytesHash(doc.text) },
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
        sources: { [doc.id]: map },
    };
    const model = {
        configurationFingerprint: "config",
        modelId: "synthetic:judge",
        nativeAnswerModelId: "synthetic:reader",
    };
    const evidence = {
        corpusId: "corpus",
        sourceId: "source",
        revisionId: "revision",
        snippet: doc.text,
        score: 1,
        locator: `indexed:0:${map.contentHash}:0-${doc.text.length}`,
    };
    const response = {
        question: dataset.questions[0].text,
        answer: "Yes.",
        mode: "synthesized",
        citations: [evidence],
        readerContext: {
            answerPath: "sources-and-views",
            serializedContextChars: doc.text.length,
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
        reason: "Supported",
    };
    const open = async (): Promise<Runtime> => ({
        bridge: {
            execute: async (request) => {
                calls.push(request);
                switch (request.operation) {
                    case "capabilities":
                        return {
                            benchmark: {
                                ...model,
                                configurationFingerprint: config,
                            },
                        };
                    case "inspect":
                        return {
                            sourceCount: 1,
                            readyRevisionCount: 1,
                            activeJobCount: 0,
                        };
                    case "retrievalSource":
                        return map;
                    case "answer":
                        return response;
                    case "generate":
                        if (failJudge)
                            throw new Error(
                                "provider unavailable, not a retrieval miss",
                            );
                        return grade;
                    default:
                        throw new Error(
                            `Unexpected operation ${String(request.operation)}`,
                        );
                }
            },
        },
        close: async () => {},
    });
    beforeEach(async () => {
        const local = path.join(process.cwd(), "local");
        await mkdir(local, { recursive: true });
        root = await mkdtemp(path.join(local, "incremental-"));
        options = {
            dataset: "qmsum",
            snapshot: path.join(root, "original"),
            references: path.join(root, "references.jsonl"),
            output: path.join(root, "experiment"),
            repo: path.join(root, "checkout"),
        };
        options.output = path.join(root, "experiment");
        await saveJson(path.join(options.snapshot, "dataset.json"), dataset);
        await saveJson(path.join(options.snapshot, "manifest.json"), manifest);
        await saveJson(path.join(options.snapshot, "native-state.json"), state);
        await saveJson(path.join(options.snapshot, "capabilities.json"), {
            benchmark: model,
        });
        await saveJson(path.join(options.snapshot, "store", "raw.json"), {
            text: doc.text,
        });
        await writeFile(options.references, raw);
        const bridge = path.join(
            options.repo,
            "ts",
            "packages",
            "memory",
            "service",
            "src",
            "benchmarkBridge.ts",
        );
        await mkdir(path.dirname(bridge), { recursive: true });
        await writeFile(bridge, "synthetic");
        calls = [];
        failJudge = false;
        config = "config";
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test("rejects output under checkout before cloning or provider calls", async () => {
        options.output = path.join(options.repo, "experiment");
        await expect(runIncremental(options, open)).rejects.toThrow("outside");
        expect(calls).toEqual([]);
    });

    test("never writes manifests, status or lock files into an existing historical namespace", async () => {
        const old = path.join(options.output, "status.json");
        await saveJson(old, { historical: true });
        const before = await readFile(old);
        await expect(runIncremental(options, open)).rejects.toThrow(
            "unowned namespace",
        );
        expect(await readFile(old)).toEqual(before);
        expect(calls).toEqual([]);
    });

    test("preregisters without model calls then saves raw answers first, resumes byte-identically", async () => {
        const original = await treeIdentity(
            path.join(options.snapshot, "store"),
        );
        expect(
            await runIncremental({ ...options, prepareOnly: true }, open),
        ).toMatchObject({ state: "preregistered", pairs: 4 });
        expect(
            calls.some(
                (call) =>
                    call.operation === "answer" ||
                    call.operation === "generate",
            ),
        ).toBe(false);
        const frozen = object(
            JSON.parse(
                await readFile(
                    path.join(options.output, "preregistration.json"),
                    "utf8",
                ),
            ),
        );
        expect(frozen.classification).toBe(
            "exploratory-inspected-regression-no-adoption",
        );
        expect(await runIncremental(options, open)).toMatchObject({
            state: "complete",
        });
        const pair = path.join(
            options.output,
            "pairs",
            "N0",
            bytesHash(dataset.questions[0].id),
        );
        const answer = await readFile(path.join(pair, "answer.json"));
        const grade = await readFile(path.join(pair, "grade.json"));
        expect(await runIncremental(options, open)).toMatchObject({
            state: "complete",
        });
        expect(await readFile(path.join(pair, "answer.json"))).toEqual(answer);
        expect(await readFile(path.join(pair, "grade.json"))).toEqual(grade);
        expect(
            calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(4);
        expect(
            calls.filter((call) => call.operation === "generate"),
        ).toHaveLength(4);
        expect(calls.filter((call) => call.operation === "answer")[0]).toEqual({
            operation: "answer",
            corpusId: "corpus",
            question: "Will capacity grow?",
            includeDiagnostics: true,
        });
        expect(await treeIdentity(path.join(options.snapshot, "store"))).toBe(
            original,
        );
        expect(
            calls.some((call) => String(call.operation).includes("ingest")),
        ).toBe(false);
        await saveJson(path.join(options.output, "rows.json"), []);
        const replay = await analyzeIncremental(options.output);
        expect(replay.arms[0].scored).toBe(1);
        expect(replay.operations).toMatchObject({
            nativeAnswerStarted: 4,
            judgeGenerateStarted: 4,
        });
    });

    test("provider failures are visible and grade-only retries never regenerate answers", async () => {
        failJudge = true;
        expect(await runIncremental(options, open)).toMatchObject({
            state: "partial",
        });
        const pair = path.join(
            options.output,
            "pairs",
            "N0",
            bytesHash(dataset.questions[0].id),
        );
        const before = await readFile(path.join(pair, "answer.json"));
        failJudge = false;
        expect(await runIncremental(options, open)).toMatchObject({
            state: "complete",
        });
        expect(await readFile(path.join(pair, "answer.json"))).toEqual(before);
        expect(
            calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(4);
        expect(
            calls.filter((call) => call.operation === "generate"),
        ).toHaveLength(8);
        expect(
            await readFile(path.join(pair, "operations.jsonl"), "utf8"),
        ).toContain("provider unavailable");
    });

    test("configuration drift fails before any answers and never silently reingests", async () => {
        await runIncremental({ ...options, prepareOnly: true }, open);
        config = "changed";
        await expect(runIncremental(options, open)).rejects.toThrow(
            "configuration/model incompatible",
        );
        expect(calls.some((call) => call.operation === "answer")).toBe(false);
    });

    test("failed native answer attempts are terminal, not retrieval misses or automatic paid retries", async () => {
        const failing = async (): Promise<Runtime> => {
            const runtime = await open();
            return {
                ...runtime,
                bridge: {
                    execute: async (request) => {
                        if (request.operation !== "answer")
                            return runtime.bridge.execute(request);
                        calls.push(request);
                        throw new Error(
                            "Native provider authentication failed",
                        );
                    },
                },
            };
        };
        expect(await runIncremental(options, failing)).toMatchObject({
            state: "partial",
        });
        expect(await runIncremental(options, failing)).toMatchObject({
            state: "partial",
        });
        expect(
            calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(4);
        expect(
            calls.filter((call) => call.operation === "generate"),
        ).toHaveLength(0);
    });

    test("compiled/source identity drift cannot silently resume old predictions", async () => {
        await runIncremental({ ...options, prepareOnly: true }, open);
        await writeFile(
            path.join(
                options.repo,
                "ts",
                "packages",
                "memory",
                "service",
                "src",
                "benchmarkBridge.ts",
            ),
            "changed source",
        );
        await expect(runIncremental(options, open)).rejects.toThrow(
            "fingerprint drift",
        );
        expect(calls.some((call) => call.operation === "answer")).toBe(false);
    });

    test("persisted raw DocParts must match canonical ranges, hashes and active revisions", async () => {
        const store = path.join(root, "raw-store");
        const index = path.join(store, "corpus", "index", "original");
        await saveJson(path.join(index, "index-schema.json"), {
            indexSchemaVersion: 1,
            engine: "knowpro",
            indexKind: "documents",
        });
        const messages = [
            {
                metadata: {
                    sourceUrl:
                        "typeagent-memory://sources/source/revisions/revision",
                },
                textChunks: [doc.text],
            },
        ];
        await saveJson(path.join(index, "corpus_data.json"), { messages });
        const input = {
            identities: [
                { documentId: doc.id, sourceId: "source", corpusId: "corpus" },
            ],
            documents: [doc],
        };
        expect(
            await verifyPersistedRawSourceMaps(store, input, { [doc.id]: map }),
        ).toMatchObject({ sources: 1, originalDocPartsVerified: true });
        messages[0].metadata.sourceUrl =
            "typeagent-memory://sources/source/revisions/stale";
        await saveJson(path.join(index, "corpus_data.json"), { messages });
        await expect(
            verifyPersistedRawSourceMaps(store, input, { [doc.id]: map }),
        ).rejects.toThrow("DocPart/revision differs");
    });

    test("explicit new query lineage admits old chat pins but freezes all NEW arm settings", async () => {
        config = "current-query-config";
        const fresh = { ...options, newQueryLineage: true };
        expect(
            await runIncremental({ ...fresh, prepareOnly: true }, open),
        ).toMatchObject({ state: "preregistered" });
        expect(await runIncremental(fresh, open)).toMatchObject({
            state: "complete",
        });
        config = "different-after-preregistration";
        await expect(runIncremental(fresh, open)).rejects.toThrow(
            "fingerprint drift",
        );
        expect(
            calls.filter((call) => call.operation === "answer"),
        ).toHaveLength(4);
    });

    test("embedding compatibility verifies exact role identities and rejects dimensions, model or schema drift", async () => {
        const identity: EmbeddingIdentity = {
            schemaVersion: 1,
            provider: "synthetic",
            model: "fixture",
            revision: "1",
            dimensions: 3,
            task: "query",
            prompt: "",
            pooling: "mean",
            normalization: "l2",
            preprocessing: "none",
            artifactHash: "a".repeat(64),
        };
        const current = {
            query: identity,
            document: { ...identity, task: "document" as const },
        };
        const store = path.join(root, "identity-store");
        const index = path.join(store, "corpus", "index", "original");
        await saveJson(path.join(index, "index-schema.json"), {
            indexSchemaVersion: 1,
            engine: "knowpro",
            indexKind: "documents",
        });
        await saveJson(path.join(index, "corpus_data.json"), {
            embeddingFileHeader: {
                identities: {
                    "message.query": current.query,
                    "message.document": current.document,
                    "relatedTerms.query": current.query,
                    "relatedTerms.document": current.document,
                },
            },
        });
        expect(
            await verifyPersistedEmbeddingIdentities(store, current),
        ).toMatchObject({
            compatibility: expect.stringContaining("no-rebuild"),
        });
        await expect(
            verifyPersistedEmbeddingIdentities(store, {
                ...current,
                query: { ...identity, model: "other" },
            }),
        ).rejects.toThrow("incompatible");
        await saveJson(path.join(index, "index-schema.json"), {
            indexSchemaVersion: 99,
            engine: "knowpro",
            indexKind: "documents",
        });
        await expect(
            verifyPersistedEmbeddingIdentities(store, current),
        ).rejects.toThrow("schema");
    });

    test("policy fingerprint drift requires a new root; N4 live is not in approved pilot budget", async () => {
        await runIncremental({ ...options, prepareOnly: true }, open);
        const n4 = { gate: "empty" as const, intervention: "N3" as const };
        await expect(
            runIncremental({ ...options, prepareOnly: true, n4 }, open),
        ).rejects.toThrow("fingerprint drift");
        await expect(runIncremental({ ...options, n4 }, open)).rejects.toThrow(
            "N0–N3 only",
        );
        expect(calls.some((call) => call.operation === "answer")).toBe(false);
    });

    test("pairs transition summaries only jointly scored; failures remain separate", () => {
        const questions = ["a", "b", "c", "d", "e"].map((id) => ({
            id,
            category: "category",
            groupId: "conversation",
        }));
        const rows = questions.flatMap(({ id, groupId, category }, i) => [
            {
                questionId: id,
                groupId,
                category,
                arm: "N0",
                state: "scored",
                correct: i === 0 || i === 2,
            },
            {
                questionId: id,
                groupId,
                category,
                arm: "N3",
                state: i === 4 ? "failed" : "scored",
                ...(i === 4 ? {} : { correct: i === 1 || i === 2 }),
            },
        ]);
        const summary = pairedSummary(rows, questions, ["N0", "N3"]);
        expect(summary.paired[0]).toMatchObject({
            jointlyScored: 4,
            rescues: 1,
            regressions: 1,
            bothCorrect: 1,
            neitherCorrect: 1,
            netPairedLift: 0,
            unmatched: ["e"],
        });
        expect(summary.arms[1]).toMatchObject({
            selected: 5,
            scored: 4,
            failed: 1,
            correctOverSelected: 0.4,
            scoredOnlyAccuracy: 0.5,
        });
    });

    test("rejects links in clone sources and never touches original store", async () => {
        const store = path.join(options.snapshot, "store");
        const hash = await treeIdentity(store);
        const target = path.join(root, "copy");
        await cloneFrozenStore(store, target, hash);
        expect(await treeIdentity(store)).toBe(hash);
        expect(await treeIdentity(target)).toBe(hash);
        await symlink(store, path.join(root, "junction"), "junction");
        await expect(treeIdentity(path.join(root, "junction"))).rejects.toThrow(
            "links/junctions",
        );
    });

    test("BEAM adapter requires frozen official protocol and never downloads", async () => {
        await expect(
            beamSnapshot({ ...options, dataset: "beam" }),
        ).rejects.toThrow("pinned official protocol");
    });

    test("validates BEAM exact cache pins, full history, archived IDs and reference separation", async () => {
        const { documentsFrom, queriesFor } = await import(
            "../src/memoryBench/data.js"
        );
        const docs = documentsFrom(syntheticData, new Set(["alice"]));
        const queries = queriesFor(syntheticData);
        const protocolFile = path.join(root, "protocol.json");
        await saveJson(protocolFile, protocol);
        const references = path.join(root, "beam.json");
        await saveJson(references, syntheticData);
        const beamManifest = {
            dataset: "beam",
            split: "100k",
            stage: "qualification",
            provider: "content",
            mode: "agent",
            dataRevision: "3205395e897e7318c7b094ef4e6047b9b82dbb03",
            dataSha256: bytesHash(await readFile(references)),
            protocolSha256: digest(protocol),
            benchmarkModel: "synthetic:judge",
            capabilities: { benchmark: model },
            queryIds: queries.map((q) => q.id),
            documentCount: docs.length,
        };
        const fingerprint = digest(beamManifest);
        const records = Object.fromEntries(
            docs.map((doc) => {
                const sourceId = digest([doc.unit, doc.id]);
                return [
                    sourceId,
                    {
                        id: doc.id,
                        unit: doc.unit,
                        sourceId,
                        ready: true,
                        sourceIds: doc.sourceIds,
                        hash: digest([
                            doc.content,
                            doc.messages,
                            doc.timestamp,
                        ]),
                    },
                ];
            }),
        );
        await saveJson(path.join(options.snapshot, "provider-state.json"), {
            fingerprint,
            units: { alice: "corpus" },
            documents: records,
        });
        await saveJson(path.join(options.snapshot, "results.json"), {
            manifest: beamManifest,
            fingerprint,
            results: queries.map((q) => ({
                queryId: q.id,
                query: q.query,
                category: q.category,
            })),
        });
        const input = {
            ...options,
            dataset: "beam" as const,
            references,
            protocol: protocolFile,
        };
        const memory = path.join(options.snapshot, "memory");
        await saveJson(path.join(memory, "corpus", "manifest.json"), {
            sources: docs.map((doc) => ({
                sourceId: digest([doc.unit, doc.id]),
                sourceType: "text",
                activeRevisionId: "beam-revision",
                revisions: [{ revisionId: "beam-revision", state: "ready" }],
            })),
        });
        const originalIndex = path.join(memory, "corpus", "index", "original");
        await saveJson(path.join(originalIndex, "index-schema.json"), {
            indexSchemaVersion: 1,
            engine: "knowpro",
            indexKind: "documents",
        });
        await saveJson(path.join(originalIndex, "corpus_data.json"), {
            messages: docs.flatMap((doc) =>
                [doc.content.slice(0, 5), doc.content.slice(5)].map((raw) => ({
                    metadata: {
                        sourceUrl: `typeagent-memory://sources/${digest([doc.unit, doc.id])}/revisions/beam-revision`,
                    },
                    textChunks: [raw],
                })),
            ),
        });
        const adapted = await beamSnapshot(input);
        expect(adapted.questions[0].text).toBe(queries[0].query);
        expect(adapted.questions[0].beam?.rubric).toEqual(["JUDGE_ONLY"]);
        expect(adapted.documents[0].text).not.toContain("JUDGE_ONLY");
        expect(adapted.store).toBe(path.join(options.snapshot, "memory"));
        expect(adapted.identities).toHaveLength(docs.length);
        expect(adapted.identities[0].map!.blocks).toHaveLength(2);
        const beamDoc = adapted.documents[0];
        const beamMap = {
            sourceId: adapted.identities[0].sourceId,
            revisionId: "beam-revision",
            contentHash: bytesHash(beamDoc.text),
            totalChars: beamDoc.text.length,
            blocks: [
                {
                    start: 0,
                    end: beamDoc.text.length,
                    sha256: bytesHash(beamDoc.text),
                },
            ],
        };
        const beamEvidence = {
            ...evidence,
            sourceId: beamMap.sourceId,
            revisionId: beamMap.revisionId,
            snippet: beamDoc.text.slice(0, 5),
            locator: `indexed:0:${bytesHash(beamDoc.text.slice(0, 5))}:0-5`,
        };
        const beamResponse = {
            ...response,
            question: queries[0].query,
            answer: "Tea",
            citations: [beamEvidence],
            readerContext: {
                answerPath: "sources-and-views",
                serializedContextChars: beamDoc.text.length,
                integratedAnswer: {
                    suppliedEvidence: [
                        { kind: "source", source: beamEvidence },
                    ],
                },
            },
        };
        await saveJson(path.join(options.snapshot, "memory", "original.json"), {
            raw: beamDoc.text,
        });
        const beamCalls: Record<string, unknown>[] = [];
        const beamRuntime = async (): Promise<Runtime> => ({
            bridge: {
                execute: async (request) => {
                    beamCalls.push(request);
                    switch (request.operation) {
                        case "capabilities":
                            return { benchmark: model };
                        case "inspect":
                            return {
                                sourceCount: 1,
                                readyRevisionCount: 1,
                                activeJobCount: 0,
                            };
                        case "retrievalSource":
                            return beamMap;
                        case "answer":
                            return beamResponse;
                        case "generate":
                            return { score: 1, reason: "Official nugget" };
                        default:
                            throw new Error("Unexpected BEAM operation");
                    }
                },
            },
            close: async () => {},
        });
        expect(await runIncremental(input, beamRuntime)).toMatchObject({
            state: "complete",
        });
        expect(
            beamCalls.filter((call) => call.operation === "answer"),
        ).toHaveLength(4);
        expect(beamCalls.find((call) => call.operation === "answer")).toEqual({
            operation: "answer",
            corpusId: "corpus",
            question: queries[0].query,
            includeDiagnostics: true,
        });
        expect(
            String(
                beamCalls.find((call) => call.operation === "generate")!.prompt,
            ),
        ).toContain("JUDGE_ONLY");
        await writeFile(references, "[]");
        await expect(beamSnapshot(input)).rejects.toThrow("pins");
    });
});
