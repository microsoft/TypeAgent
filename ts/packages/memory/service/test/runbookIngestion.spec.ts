// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import {
    mkdir,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { RunbookJobStore } from "../src/runbookJobs.js";
import {
    assertBatchImportRequest,
    batchImportRequestByteLimit,
    measureBatchImportBytes,
    MemoryBatchStore,
    type MemoryBatchImportRequest,
} from "../src/batchImport.js";
import {
    assetDigest,
    RevisionAssetStore,
    validateAssetInputs,
} from "../src/revisionAssetStore.js";
import {
    synthesisCandidates,
    type RunbookSynthesisInput,
    type RunbookSynthesisOutput,
} from "../src/runbookPipeline.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import type {
    DocumentIngestRequest,
    IndexedDocument,
    IngestionJobStatus,
} from "../src/types.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

class AbortableIndex extends FakeProcedureCorpusIndex {
    public constructor(
        directory: string,
        private readonly blocked?: () => void,
    ) {
        super(directory);
    }

    public override async rebuild(
        documents: IndexedDocument[],
        signal?: AbortSignal,
    ): Promise<void> {
        if (documents.some((document) => document.source.title === "Blocked")) {
            if (!signal) throw new Error("Expected ingestion abort signal");
            signal.throwIfAborted();
            this.blocked?.();
            await new Promise<never>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                }),
            );
        }
        await super.rebuild(documents);
    }
}

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const content =
    "# How to investigate\n\n1. Open the dashboard.\n2. If exit code is 137, inspect heap alerts.\n";

async function waitFor<T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
): Promise<T> {
    for (let index = 0; index < 500; index++) {
        const value = await read();
        if (done(value)) return value;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
        `Offline fixture did not settle: ${JSON.stringify(await read())}`,
    );
}

function output(input: RunbookSynthesisInput): RunbookSynthesisOutput {
    const humanText = "Open the dashboard.";
    const start = input.content.indexOf(humanText);
    return {
        classification: "runbook",
        confidence: 0.9,
        reason: "Troubleshooting procedure",
        warnings: [],
        procedures: [
            {
                sectionFingerprint: "investigate",
                title: "Investigate",
                agentEdition: {
                    schemaVersion: 1,
                    goal: "Investigate",
                    applicability: [],
                    inputs: [],
                    preconditions: ["Read access"],
                    steps: [
                        {
                            id: "open",
                            title: "Open",
                            humanText,
                            agentInstruction: "Open the dashboard.",
                            safety: "readOnly",
                            citations: [
                                {
                                    sourceId: input.sourceId,
                                    revisionId: input.revisionId,
                                    locator: `chars:${start}-${start + humanText.length}`,
                                    excerpt: humanText,
                                },
                            ],
                        },
                    ],
                    verification: [],
                    rollback: [],
                    synthesis: { sourceReferences: [] },
                    review: { state: "draft" },
                },
            },
        ],
    };
}

describe("revision assets and post-commit runbook ingestion", () => {
    let root: string;
    let service: FileMemoryService;
    beforeEach(async () => {
        root = path.resolve(".test-fixtures", `runbook-${randomUUID()}`);
        await mkdir(root, { recursive: true });
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async (input) => output(input),
        });
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    async function capture(
        request: DocumentIngestRequest,
    ): Promise<IngestionJobStatus> {
        const result = await service.ingestDocument(request);
        const job = await waitFor(
            () => service.getJob(result.jobId),
            (job) =>
                !!job &&
                ["complete", "failed", "cancelled"].includes(job.state),
        );
        if (!job) throw new Error("Missing job");
        return job;
    }

    test("immutable assets require exact revision/hash; originals never masquerade as previews", async () => {
        const corpus = await service.createCorpus("assets");
        const request: DocumentIngestRequest = {
            corpusId: corpus.corpusId,
            source: {
                sourceId: "guide",
                sourceType: "markdown",
                title: "Guide",
                markdown: content,
                assets: [
                    {
                        name: "screen.png",
                        mimeType: "image/png",
                        bytes: png,
                        instructionBearing: true,
                    },
                ],
            },
        };
        const job = await capture(request);
        expect(job.state).toBe("complete");
        const identity = {
            corpusId: corpus.corpusId,
            sourceId: "guide",
            revisionId: job.revisionId,
        };
        const [asset] = await service.getRevisionAssets(identity);
        expect(asset.hash).toBe(assetDigest(png));
        const read = {
            ...identity,
            assetId: asset.assetId,
            hash: asset.hash,
            variant: "original" as const,
        };
        expect((await service.readRevisionAsset(read)).bytes).toEqual(png);
        await expect(
            service.readRevisionAsset({ ...read, hash: "wrong" }),
        ).rejects.toThrow("digest");
        await expect(
            service.readRevisionAsset({ ...read, variant: "preview" }),
        ).rejects.toThrow("Safe preview unavailable");
        await expect(
            service.getRevisionAssets({ ...identity, revisionId: "wrong" }),
        ).rejects.toThrow("Unknown retained");
        const replaced = await capture({
            ...request,
            source: {
                ...request.source,
                markdown: `${content}\nUpdated`,
                assets: [],
            },
            pipeline: { updatePolicy: "replaceActiveRevision" },
        });
        expect(replaced.state).toBe("complete");
        await expect(service.getRevisionAssets(identity)).rejects.toThrow(
            "Unknown retained",
        );
        expect(
            await readdir(
                path.join(
                    root,
                    corpus.corpusId,
                    "revision-assets",
                    assetDigest(Buffer.from("guide")),
                ),
            ),
        ).toEqual([]);
    });

    test("entire original HTML is retained verbatim across restart, not only extracted text", async () => {
        const corpus = await service.createCorpus("html-original");
        const html =
            '\uFEFF \r\n<!doctype html><html><head><style>.status { color: red; }</style></head><body><table><tr><td>If exit code is 137</td><td>Inspect heap alerts \u00e9</td></tr></table><img src="images/screen.png"></body></html>\r\n ';
        const captured = await capture({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "html-original",
                sourceType: "html",
                title: "Original HTML",
                html,
            },
        });
        const request = {
            corpusId: corpus.corpusId,
            sourceId: "html-original",
            revisionId: captured.revisionId,
            maxChars: html.length,
        };
        expect(await service.getSourceContent(request)).toMatchObject({
            content: html,
            totalChars: html.length,
            truncated: false,
        });
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
        expect(await service.getSourceContent(request)).toMatchObject({
            content: html,
            totalChars: html.length,
            truncated: false,
        });
    });

    test("asset signatures, paths, size and digest are enforced", async () => {
        expect(() =>
            validateAssetInputs([
                { name: "..\\secret", mimeType: "image/png", bytes: png },
            ]),
        ).toThrow("path");
        expect(() =>
            validateAssetInputs([
                { name: "a.svg", mimeType: "image/svg+xml", bytes: png },
            ]),
        ).toThrow("MIME");
        expect(() =>
            validateAssetInputs([
                {
                    name: "a.png",
                    mimeType: "image/png",
                    bytes: new Uint8Array(7 * 1024 * 1024),
                },
            ]),
        ).toThrow("oversized");
        expect(() =>
            validateAssetInputs([
                {
                    name: "screen.png",
                    mimeType: "image/png",
                    bytes: png,
                    description: "x".repeat(2001),
                },
            ]),
        ).toThrow("metadata limit");
        expect(() =>
            validateAssetInputs([
                {
                    name: "screen.png",
                    mimeType: "image/png",
                    bytes: png,
                    warnings: ["x".repeat(1001)],
                },
            ]),
        ).toThrow("metadata limit");
        const store = new RevisionAssetStore(root);
        const identity = {
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
        };
        const [asset] = await store.retain(identity, [
            { name: "screen.png", mimeType: "image/png", bytes: png },
        ]);
        await writeFile(
            path.join(
                root,
                "corpus",
                "revision-assets",
                assetDigest(Buffer.from("source")),
                "revision",
                `${asset.assetId}.bin`,
            ),
            "tampered",
        );
        await expect(
            store.read(
                {
                    ...identity,
                    assetId: asset.assetId,
                    hash: asset.hash,
                    variant: "original",
                },
                asset,
            ),
        ).rejects.toThrow("digest");
    });

    test("symlink/junction directories cannot redirect owned asset storage", async () => {
        const outside = path.join(root, "unrelated");
        await mkdir(outside);
        await symlink(outside, path.join(root, "redirect"), "junction");
        const store = new RevisionAssetStore(root);
        await expect(
            store.retain(
                {
                    corpusId: "redirect",
                    sourceId: "guide",
                    revisionId: "revision",
                },
                [{ name: "screen.png", mimeType: "image/png", bytes: png }],
            ),
        ).rejects.toThrow("Unsafe asset directory");
        expect(await readdir(outside)).toEqual([]);
    });

    test("asset ownership distinguishes case-sensitive and legacy source identities on Windows", async () => {
        const store = new RevisionAssetStore(root);
        const assets = [
            { name: "screen.png", mimeType: "image/png", bytes: png },
        ];
        const identity = {
            corpusId: "corpus",
            sourceId: "Guide",
            revisionId: "revision",
        };
        const [original] = await store.retain(identity, assets);
        const other = { ...identity, sourceId: "guide" };
        const [retained] = await store.retain(other, assets);
        const legacy = { ...identity, sourceId: "legacy:source" };
        const [legacyAsset] = await store.retain(legacy, assets);
        await store.removeRevision(identity);
        for (const [request, descriptor] of [
            [other, retained],
            [legacy, legacyAsset],
        ] as const) {
            expect(
                await store.read(
                    {
                        ...request,
                        assetId: descriptor.assetId,
                        hash: descriptor.hash,
                        variant: "original",
                    },
                    descriptor,
                ),
            ).toEqual(png);
        }
        expect(original.sourceId).toBe("Guide");
        expect(legacyAsset.sourceId).toBe("legacy:source");
    });

    test("retained asset history survives replacement; forget and clear preserve unrelated files", async () => {
        const corpus = await service.createCorpus("history");
        const source = {
            sourceId: "guide",
            sourceType: "markdown" as const,
            title: "Guide",
            markdown: content,
            assets: [{ name: "screen.png", mimeType: "image/png", bytes: png }],
        };
        const original = await capture({ corpusId: corpus.corpusId, source });
        await capture({
            corpusId: corpus.corpusId,
            source: { ...source, markdown: `${content}\nChanged` },
            pipeline: { updatePolicy: "retainRevisionHistory" },
        });
        expect(
            await service.getRevisionAssets({
                corpusId: corpus.corpusId,
                sourceId: "guide",
                revisionId: original.revisionId,
            }),
        ).toHaveLength(1);
        const unrelated = path.join(root, corpus.corpusId, "unrelated.txt");
        await writeFile(unrelated, "keep");
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "guide",
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: "guide",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await readdir(
                path.join(
                    root,
                    corpus.corpusId,
                    "revision-assets",
                    assetDigest(Buffer.from("guide")),
                ),
            ),
        ).toEqual([]);
        expect(await readFile(unrelated, "utf8")).toBe("keep");
        await service.clearCorpus(corpus.corpusId);
        expect(await readFile(unrelated, "utf8")).toBe("keep");
    });

    test("full-document synthesis is postcommit, draft, idempotent and settings-aware", async () => {
        const corpus = await service.createCorpus("runbooks");
        const settings = await service.getPersonalHowToSettings(
            corpus.corpusId,
        );
        await service.updatePersonalHowToSettings(corpus.corpusId, {
            expectedRevision: settings.revision,
            enabled: true,
            detectCandidates: true,
            preferences: { runbook: { buildAgentEdition: true } },
        });
        const request: DocumentIngestRequest = {
            corpusId: corpus.corpusId,
            source: {
                sourceId: "guide",
                sourceType: "markdown",
                title: "Guide",
                markdown: content,
            },
        };
        expect((await capture(request)).state).toBe("complete");
        const jobs = await waitFor(
            () => service.listRunbookJobs(corpus.corpusId),
            (jobs) => jobs.length === 1 && jobs[0].state !== "running",
        );
        expect(jobs[0].state).toBe("complete");
        const candidates = await service.listProcedureCandidates(
            corpus.corpusId,
        );
        const edition = candidates.find(
            (candidate) => candidate.agentEdition,
        )?.agentEdition;
        expect(edition?.review.state).toBe("draft");
        expect(edition?.steps[0].humanText).toBe("Open the dashboard.");
        await capture(request);
        expect((await service.listRunbookJobs(corpus.corpusId)).length).toBe(1);
        expect(
            (await service.listProcedureCandidates(corpus.corpusId)).length,
        ).toBe(candidates.length);
        const synthesized = candidates.find(
            (candidate) => candidate.agentEdition,
        );
        if (!synthesized?.agentEdition)
            throw new Error("Missing synthesized fixture");
        const altered = structuredClone(synthesized);
        altered.agentEdition!.steps[0].citations[0].locator = "chars:0-1";
        await expect(
            service.saveProcedure({
                corpusId: corpus.corpusId,
                document: altered,
                reviewAgentEdition: true,
                safetyConfirmed: true,
            }),
        ).rejects.toThrow("retained passage offsets");
        await capture({
            ...request,
            source: { ...request.source, markdown: `${content}\nNew revision` },
            pipeline: { updatePolicy: "retainRevisionHistory" },
        });
        await expect(
            service.saveProcedure({
                corpusId: corpus.corpusId,
                document: synthesized,
                reviewAgentEdition: true,
                safetyConfirmed: true,
            }),
        ).rejects.toThrow("source revision is stale");
        expect(
            (
                await service.getProcedureCandidate(
                    corpus.corpusId,
                    synthesized.candidateId,
                )
            )?.state,
        ).toBe("rejected");
    });

    test("explicit synthesis uses retained evidence and guidance, reuses work and preserves saved edits across restart", async () => {
        await service.close();
        let calls = 0;
        let observed: RunbookSynthesisInput | undefined;
        let release: (() => void) | undefined;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async (input, signal) => {
                calls++;
                observed = structuredClone(input);
                await barrier;
                signal.throwIfAborted();
                return output(input);
            },
        });
        const corpus = await service.createCorpus("explicit");
        const captured = await capture({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "guide",
                sourceType: "markdown",
                title: "Guide",
                markdown: content,
            },
        });
        if (!captured.revisionId) throw new Error("Missing captured revision");
        const request = {
            corpusId: corpus.corpusId,
            sourceId: "guide",
            revisionId: captured.revisionId,
        };
        await expect(service.requestRunbookSynthesis(request)).rejects.toThrow(
            "buildAgentEdition",
        );
        expect(calls).toBe(0);
        const settings = await service.getPersonalHowToSettings(
            corpus.corpusId,
        );
        await service.updatePersonalHowToSettings(corpus.corpusId, {
            expectedRevision: settings.revision,
            enabled: true,
            detectCandidates: true,
            preferences: {
                extractionGuidance: "Include conditions",
                runbook: { buildAgentEdition: true },
            },
        });
        const [first, concurrent] = await Promise.all([
            service.requestRunbookSynthesis(request),
            service.requestRunbookSynthesis(request),
        ]);
        expect(first.jobId).toBe(concurrent.jobId);
        expect(first.state).toBe("running");
        await waitFor(
            async () => calls,
            (value) => value === 1,
        );
        expect(observed).toMatchObject({
            ...request,
            content,
            guidance: "Include conditions",
        });
        if (!release) throw new Error("Missing synthesis barrier");
        release();
        const completed = await waitFor(
            () => service.getRunbookJob(first.jobId),
            (job) => job?.state === "complete",
        );
        if (!completed?.candidateIds[0])
            throw new Error("Missing generated candidate");
        const candidate = await service.getProcedureCandidate(
            corpus.corpusId,
            completed.candidateIds[0],
        );
        if (!candidate) throw new Error("Missing candidate");
        const saved = await service.saveProcedure({
            corpusId: corpus.corpusId,
            candidateId: candidate.candidateId,
            document: {
                ...candidate,
                title: "Owner edited title",
                additionalSections: [
                    { heading: "Owner notes", content: "Preserve these notes" },
                ],
            },
        });
        const savedCandidate = await service.getProcedureCandidate(
            corpus.corpusId,
            candidate.candidateId,
        );
        const reused = await service.requestRunbookSynthesis(request);
        expect(reused.jobId).toBe(completed.jobId);
        expect(reused.candidateIds).toEqual(completed.candidateIds);
        expect(calls).toBe(1);
        expect(
            await service.getProcedureCandidate(
                corpus.corpusId,
                candidate.candidateId,
            ),
        ).toEqual(savedCandidate);
        expect(
            await service.getProcedure(
                corpus.corpusId,
                saved.procedureId,
                saved.version,
            ),
        ).toEqual(saved);
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async () => {
                throw new Error("Completed work must not call a model");
            },
        });
        expect((await service.requestRunbookSynthesis(request)).jobId).toBe(
            completed.jobId,
        );
        expect(
            await service.getProcedure(
                corpus.corpusId,
                saved.procedureId,
                saved.version,
            ),
        ).toEqual(saved);
    });

    test("explicit synthesis retries durable model failures and rejects missing or inactive revisions", async () => {
        await service.close();
        let fail = true;
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async (input) => {
                if (fail) throw new Error("Offline model unavailable");
                return output(input);
            },
        });
        const corpus = await service.createCorpus("explicit-failure");
        const source = {
            sourceId: "guide",
            sourceType: "markdown" as const,
            title: "Guide",
            markdown: content,
        };
        const captured = await capture({ corpusId: corpus.corpusId, source });
        if (!captured.revisionId) throw new Error("Missing captured revision");
        const request = {
            corpusId: corpus.corpusId,
            sourceId: "guide",
            revisionId: captured.revisionId,
        };
        const settings = await service.getPersonalHowToSettings(
            corpus.corpusId,
        );
        await service.updatePersonalHowToSettings(corpus.corpusId, {
            expectedRevision: settings.revision,
            preferences: { runbook: { buildAgentEdition: true } },
        });
        await expect(
            service.requestRunbookSynthesis({
                ...request,
                revisionId: "missing",
            }),
        ).rejects.toThrow("missing");
        const accepted = await service.requestRunbookSynthesis(request);
        const failed = await waitFor(
            () => service.getRunbookJob(accepted.jobId),
            (job) => job?.state === "failed",
        );
        expect(failed?.reason).toContain("Offline model unavailable");
        expect(
            (
                await service.getSourceContent({
                    ...request,
                    maxChars: content.length,
                })
            ).content,
        ).toBe(content);
        fail = false;
        const retried = await service.requestRunbookSynthesis(request);
        expect(retried.jobId).not.toBe(accepted.jobId);
        const completed = await waitFor(
            () => service.getRunbookJob(retried.jobId),
            (job) => job?.state === "complete",
        );
        expect(completed?.candidateIds.length).toBeGreaterThan(0);
        const updated = await capture({
            corpusId: corpus.corpusId,
            source: { ...source, markdown: `${content}\nUpdated source` },
            pipeline: { updatePolicy: "retainRevisionHistory" },
        });
        if (!updated.revisionId) throw new Error("Missing updated revision");
        await expect(service.requestRunbookSynthesis(request)).rejects.toThrow(
            "stale",
        );
        const current = await service.requestRunbookSynthesis({
            ...request,
            revisionId: updated.revisionId,
        });
        const fresh = await waitFor(
            () => service.getRunbookJob(current.jobId),
            (job) => job?.state === "complete",
        );
        expect(fresh?.candidateIds).not.toEqual(completed?.candidateIds);
    });

    test("background result persistence failures surface explicitly instead of remaining running", async () => {
        let started = false;
        let release: (() => void) | undefined;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        const input: RunbookSynthesisInput = {
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            title: "Guide",
            content,
            assets: [],
            images: [],
            seeds: [],
            preferences: {
                buildAgentEdition: true,
                describeImages: false,
                mcpTools: false,
                approvedAutomations: false,
            },
        };
        const store = new RunbookJobStore(
            root,
            async (evidence, signal) => {
                started = true;
                await barrier;
                signal.throwIfAborted();
                return output(evidence);
            },
            async () => {},
        );
        try {
            const job = await store.start(input);
            await waitFor(
                async () => started,
                (value) => value,
            );
            const file = path.join(root, "runbook-jobs", `${job.jobId}.json`);
            await rm(file);
            await mkdir(file);
            await store.close();
            await expect(store.get(job.jobId)).rejects.toThrow(
                "could not be persisted",
            );
        } finally {
            release?.();
            await store.close();
        }
    });

    test("model failure leaves source and deterministic seed committed with explicit result", async () => {
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async () => {
                throw new Error("Offline configured model unavailable");
            },
        });
        const corpus = await service.createCorpus("failure");
        const settings = await service.getPersonalHowToSettings(
            corpus.corpusId,
        );
        await service.updatePersonalHowToSettings(corpus.corpusId, {
            expectedRevision: settings.revision,
            preferences: { runbook: { buildAgentEdition: true } },
        });
        expect(
            (
                await capture({
                    corpusId: corpus.corpusId,
                    source: {
                        sourceId: "guide",
                        sourceType: "markdown",
                        title: "Guide",
                        markdown: content.replace(
                            "Open the dashboard.",
                            "Run curl --token secretFixtureValue.",
                        ),
                    },
                })
            ).state,
        ).toBe("complete");
        const jobs = await waitFor(
            () => service.listRunbookJobs(corpus.corpusId),
            (jobs) => jobs.length === 1 && jobs[0].state !== "running",
        );
        expect(jobs[0].state).toBe("failed");
        expect(jobs[0].reason).toContain("configured model unavailable");
        expect(await service.listSources(corpus.corpusId)).toHaveLength(1);
        expect(
            (await service.listProcedureCandidates(corpus.corpusId)).length,
        ).toBeGreaterThan(0);
        expect(
            JSON.stringify(
                await service.listProcedureCandidates(corpus.corpusId),
            ),
        ).not.toContain("secretFixtureValue");
    });

    test("unsupported evidence is manual and secrets and bindings are never accepted", () => {
        const input: RunbookSynthesisInput = {
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            title: "Guide",
            content,
            assets: [],
            images: [],
            preferences: {
                buildAgentEdition: true,
                describeImages: false,
                mcpTools: false,
                approvedAutomations: false,
            },
            seeds: [],
        };
        const result = output(input);
        result.procedures[0].agentEdition.steps[0].citations[0].locator =
            "chars:0-1";
        result.procedures[0].agentEdition.steps[0].binding = {
            kind: "command",
            text: "curl --token abc123",
            accepted: true,
        };
        const [candidate] = synthesisCandidates(input, result);
        expect(candidate.agentEdition?.review.state).toBe("draft");
        expect(candidate.agentEdition?.steps[0].manualReason).toContain(
            "unsupported",
        );
        expect(candidate.agentEdition?.steps[0].binding).toBeUndefined();
        expect(candidate.agentEdition?.steps[0].citations).toEqual([]);
        result.warnings = ["x".repeat(1001)];
        expect(() => synthesisCandidates(input, result)).toThrow(
            "bounded synthesis result",
        );
    });

    test("declared vision forwards retained PNG bytes; undeclared or unsupported images remain manual offline", async () => {
        const image = new Uint8Array(
            Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c2ioAAAAASUVORK5CYII=",
                "base64",
            ),
        );
        const gif = new Uint8Array(
            Buffer.from(
                "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
                "base64",
            ),
        );
        for (const scenario of [
            {
                declared: true,
                mimeType: "image/png",
                bytes: image,
                name: "screen.png",
                available: true,
            },
            {
                declared: false,
                mimeType: "image/png",
                bytes: image,
                name: "screen.png",
                available: false,
            },
            {
                declared: true,
                mimeType: "image/gif",
                bytes: gif,
                name: "screen.gif",
                available: false,
            },
        ]) {
            await service.close();
            let observed: RunbookSynthesisInput | undefined;
            service = new FileMemoryService(root, {
                indexFactory: (_corpus, directory) =>
                    new FakeProcedureCorpusIndex(directory),
                ...(scenario.declared ? { runbookMultimodal: true } : {}),
                runbookSynthesizer: async (input) => {
                    observed = structuredClone(input);
                    return output(input);
                },
            });
            const corpus = await service.createCorpus(
                `vision-fixture-${scenario.declared}-${scenario.name}`,
            );
            const settings = await service.getPersonalHowToSettings(
                corpus.corpusId,
            );
            await service.updatePersonalHowToSettings(corpus.corpusId, {
                expectedRevision: settings.revision,
                enabled: true,
                detectCandidates: true,
                preferences: {
                    runbook: { buildAgentEdition: true, describeImages: true },
                },
            });
            const captured = await capture({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "guide",
                    sourceType: "markdown",
                    title: "Guide",
                    markdown: content,
                    assets: [
                        {
                            name: scenario.name,
                            mimeType: scenario.mimeType,
                            bytes: scenario.bytes,
                            instructionBearing: true,
                        },
                    ],
                },
            });
            expect(captured.state).toBe("complete");
            const jobs = await waitFor(
                () => service.listRunbookJobs(corpus.corpusId),
                (jobs) => jobs.length === 1 && jobs[0].state !== "running",
            );
            expect(jobs[0].state).toBe("complete");
            if (!observed)
                throw new Error("Missing injected synthesis evidence");
            expect(observed.images).toHaveLength(scenario.available ? 1 : 0);
            if (scenario.available) {
                expect(observed.images[0].bytes).toEqual(scenario.bytes);
                expect(observed.images[0].assetId).toBe(
                    observed.assets[0].assetId,
                );
                expect(observed.images[0].mimeType).toBe(scenario.mimeType);
                expect(assetDigest(observed.images[0].bytes)).toBe(
                    observed.assets[0].hash,
                );
            }
            const candidates = await service.listProcedureCandidates(
                corpus.corpusId,
            );
            const step = candidates.find((candidate) => candidate.agentEdition)
                ?.agentEdition?.steps[0];
            expect(Boolean(step?.manualReason)).toBe(!scenario.available);
        }
    });

    test("unavailable instruction-bearing images force manual instructions without guessed pixels", () => {
        const input: RunbookSynthesisInput = {
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            title: "Guide",
            content,
            images: [],
            seeds: [],
            preferences: {
                buildAgentEdition: true,
                describeImages: true,
                mcpTools: false,
                approvedAutomations: false,
            },
            assets: [
                {
                    sourceId: "source",
                    revisionId: "revision",
                    assetId: "image",
                    mimeType: "image/png",
                    name: "screen.png",
                    size: png.length,
                    hash: assetDigest(png),
                    instructionBearing: true,
                },
            ],
        };
        const [candidate] = synthesisCandidates(input, output(input));
        expect(candidate.agentEdition?.steps[0].manualReason).toContain(
            "Instruction-bearing image unavailable",
        );
        expect(candidate.agentEdition?.steps[0].agentInstruction).toContain(
            "do not infer",
        );
    });

    test("disabled runbook preferences never touch injected or configured models", async () => {
        let calls = 0;
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async (input) => {
                calls++;
                return output(input);
            },
        });
        const corpus = await service.createCorpus("disabled");
        await capture({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "legacy:source",
                sourceType: "markdown",
                title: "Guide",
                markdown: content,
            },
        });
        expect(calls).toBe(0);
        expect(await service.listRunbookJobs(corpus.corpusId)).toEqual([]);
        expect(await service.clearCorpus(corpus.corpusId)).toBe(1);
    });

    test("multiple procedures preserve branches, alternatives, prerequisites and verified retained links", () => {
        const input: RunbookSynthesisInput = {
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            title: "Guide",
            content: `${content}\nSee https://example.test/heap`,
            assets: [],
            images: [],
            preferences: {
                buildAgentEdition: true,
                describeImages: false,
                mcpTools: false,
                approvedAutomations: false,
            },
            seeds: [],
            linkedDocuments: [
                {
                    sourceId: "heap",
                    revisionId: "retained",
                    title: "Heap",
                    canonicalUri: "https://example.test/heap",
                },
            ],
        };
        const result = output(input);
        const first = result.procedures[0];
        first.agentEdition.steps[0].condition = "If exit code is 137";
        first.agentEdition.synthesis.linkedDocuments = [
            { sourceId: "heap", revisionId: "retained" },
            { sourceId: "invented", revisionId: "wrong" },
        ];
        result.procedures.push({
            ...structuredClone(first),
            sectionFingerprint: "heap",
            title: "Heap alerts",
        });
        const candidates = synthesisCandidates(input, result);
        expect(candidates).toHaveLength(2);
        expect(candidates[0].candidateId).not.toBe(candidates[1].candidateId);
        expect(candidates[0].agentEdition?.steps[0].condition).toBe(
            "If exit code is 137",
        );
        expect(candidates[0].agentEdition?.preconditions).toEqual([
            "Read access",
        ]);
        expect(candidates[0].agentEdition?.synthesis.linkedDocuments).toEqual([
            { sourceId: "heap", revisionId: "retained" },
        ]);
    });

    test("restart records interrupted synthesis without touching a model or reverting capture", async () => {
        const corpus = await service.createCorpus("restart");
        const captured = await capture({
            corpusId: corpus.corpusId,
            source: {
                sourceType: "markdown",
                title: "Guide",
                markdown: content,
            },
        });
        const jobId = randomUUID();
        await service.close();
        await mkdir(path.join(root, "runbook-jobs"));
        await writeFile(
            path.join(root, "runbook-jobs", `${jobId}.json`),
            JSON.stringify({
                jobId,
                corpusId: corpus.corpusId,
                sourceId: captured.sourceId,
                revisionId: captured.revisionId,
                state: "running",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                candidateIds: [],
                warnings: [],
            }),
        );
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async () => {
                throw new Error("Offline model must not be touched");
            },
        });
        const job = await service.getRunbookJob(jobId);
        expect(job?.state).toBe("interrupted");
        expect(job?.reason).toContain("source capture remains committed");
        expect(await service.listSources(corpus.corpusId)).toHaveLength(1);
    });

    test("batch cancellation aborts real underlying ingestion, not just presentation state", async () => {
        await service.close();
        const blocked = deferred();
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new AbortableIndex(directory, blocked.resolve),
            runbookSynthesizer: async (input) => output(input),
        });
        const corpus = await service.createCorpus("cancel");
        const batch = await service.startBatchImport({
            corpusId: corpus.corpusId,
            idempotencyKey: "cancel",
            documents: [
                {
                    source: {
                        sourceType: "markdown",
                        title: "Blocked",
                        markdown: content,
                    },
                },
            ],
        });
        await blocked.promise;
        const active = await waitFor(
            () => service.getBatchImport(batch.batchId),
            (batch) => batch.members[0].jobId !== undefined,
        );
        const jobId = active.members[0].jobId;
        if (!jobId) throw new Error("Missing active ingestion job");
        const [cancelled] = await Promise.all([
            service.cancelBatchImport(batch.batchId),
            service.cancelJob(jobId),
            service.cancelJob(jobId),
        ]);
        expect(cancelled.state).toBe("cancelled");
        expect(cancelled.members[0].state).toBe("cancelled");
        expect((await service.getJob(jobId))?.state).toBe("cancelled");
        expect((await service.cancelJob(jobId))?.state).toBe("cancelled");
        expect(await service.listSources(corpus.corpusId)).toEqual([]);
    });

    test("forgetting a source removes only its completed batch members and preserves unrelated captures", async () => {
        const corpus = await service.createCorpus("forget-batch");
        await capture({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "guide",
                sourceType: "markdown",
                title: "Guide",
                markdown: content,
            },
        });
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "guide",
        );
        const batch = await service.startBatchImport({
            corpusId: corpus.corpusId,
            idempotencyKey: "forget-one",
            documents: [
                {
                    source: {
                        sourceId: "guide",
                        sourceType: "markdown",
                        title: "Updated guide",
                        markdown: `${content}\nChanged`,
                    },
                },
                {
                    source: {
                        sourceId: "other",
                        sourceType: "markdown",
                        title: "Other",
                        markdown: "Unrelated reference material",
                    },
                },
            ],
        });
        await waitFor(
            () => service.getBatchImport(batch.batchId),
            (batch) => batch.state === "complete",
        );
        await expect(
            service.forgetSource({
                corpusId: corpus.corpusId,
                sourceId: "guide",
                confirmationToken: preview.confirmationToken,
            }),
        ).rejects.toThrow("Invalid or stale source forget confirmation");
        const refreshed = await service.previewForgetSource(
            corpus.corpusId,
            "guide",
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: "guide",
            confirmationToken: refreshed.confirmationToken,
        });
        const retained = await service.getBatchImport(batch.batchId);
        expect(retained.members[0].reason).toBe(
            "Source forgotten; acquired content removed",
        );
        expect(retained.members[1].state).toBe("complete");
        expect((await service.getJob(retained.members[1].jobId!))?.state).toBe(
            "complete",
        );
        expect(
            (await service.listSources(corpus.corpusId)).map(
                (source) => source.sourceId,
            ),
        ).toEqual(["other"]);
    });

    test("source-scoped cancellation aborts only its admitted job and preserves unrelated captures", async () => {
        await service.close();
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) => new AbortableIndex(directory),
            runbookSynthesizer: async (input) => output(input),
        });
        const corpus = await service.createCorpus("selective-cancel");
        const entered = deferred();
        const resume = deferred();
        const cancelled: string[] = [];
        let unrelatedJobId: string | undefined;
        const store = new MemoryBatchStore(root, {
            ingestDocument: async (request) => {
                if (request.source.sourceId === "guide") {
                    entered.resolve();
                    await resume.promise;
                }
                const result = await service.ingestDocument(request);
                if (request.source.sourceId === "other")
                    unrelatedJobId = result.jobId;
                return result;
            },
            getJob: (jobId) => service.getJob(jobId),
            cancelJob: (jobId) => {
                cancelled.push(jobId);
                return service.cancelJob(jobId);
            },
        });
        try {
            const batch = await store.start({
                corpusId: corpus.corpusId,
                idempotencyKey: "selective-cancel",
                documents: [
                    {
                        source: {
                            sourceId: "guide",
                            sourceType: "markdown",
                            title: "Blocked",
                            markdown: content,
                        },
                    },
                    {
                        source: {
                            sourceId: "other",
                            sourceType: "text",
                            title: "Other",
                            text: "Unrelated reference material",
                        },
                    },
                ],
            });
            await entered.promise;
            await waitFor(
                async () =>
                    unrelatedJobId === undefined
                        ? undefined
                        : service.getJob(unrelatedJobId),
                (job) => job?.state === "complete",
            );
            const cancelling = store.cancelSource(corpus.corpusId, "guide");
            resume.resolve();
            await cancelling;
            const retained = await store.get(batch.batchId);
            expect(retained.members.map((member) => member.state)).toEqual([
                "cancelled",
                "complete",
            ]);
            expect(cancelled).toEqual([retained.members[0].jobId]);
            expect(
                (await service.listSources(corpus.corpusId)).map(
                    (source) => source.sourceId,
                ),
            ).toEqual(["other"]);
        } finally {
            resume.resolve();
            await store.close();
        }
    });

    test("acquisition rejections and opaque client keys persist; lookup recovers lost responses without new content", async () => {
        const corpus = await service.createCorpus("acquisition");
        const key = {
            corpusId: corpus.corpusId,
            idempotencyKey: "lost-response",
        };
        expect(await service.findBatchImport(key)).toBeUndefined();
        const request = {
            ...key,
            acquisitionFingerprint: assetDigest(Buffer.from("selected-files")),
            warnings: ["Unassociated image ignored"],
            documents: [
                {
                    source: {
                        sourceType: "markdown" as const,
                        title: "folder\\Guide",
                        markdown: content,
                    },
                },
            ],
            documentKeys: ["selected-file-1"],
            documentWarnings: [
                ["Missing image missing.png requires manual inspection"],
            ],
            acquisitionIssues: [
                {
                    member: "selected-file-1",
                    state: "warning" as const,
                    reason: "Some images unavailable",
                },
                {
                    member: "selected-file-2",
                    state: "rejected" as const,
                    reason: "Unsupported archive",
                },
            ],
            rejectedMembers: [
                {
                    memberKey: "selected-file-2",
                    displayName: "archive.zip",
                    reason: "Unsupported archive",
                },
            ],
        };
        const accepted = await service.startBatchImport(request);
        const batch = await waitFor(
            () => service.getBatchImport(accepted.batchId),
            (batch) => batch.state !== "running",
        );
        expect(batch.state).toBe("partial");
        expect(batch.members).toHaveLength(2);
        expect(batch.acquisitionIssues).toEqual(request.acquisitionIssues);
        expect(batch.warnings).toEqual(request.warnings);
        expect(batch.acquisitionFingerprint).toBe(
            request.acquisitionFingerprint,
        );
        expect(batch.members[0]).toMatchObject({
            clientKey: "selected-file-1",
            displayName: "Guide",
            title: "folder\\Guide",
            stage: "ingestion",
            state: "complete",
        });
        expect(batch.members[0].warnings).toContain(
            "Missing image missing.png requires manual inspection",
        );
        expect(batch.members[1]).toMatchObject({
            clientKey: "selected-file-2",
            stage: "acquisition",
            state: "failed",
            displayName: "archive.zip",
            reason: "Acquisition rejected: Unsupported archive",
        });
        expect(batch.members[1].jobId).toBeUndefined();
        expect((await service.findBatchImport(key))?.members[0].jobId).toBe(
            batch.members[0].jobId,
        );
        expect((await service.startBatchImport(request)).batchId).toBe(
            batch.batchId,
        );
        await expect(service.retryBatchImport(batch.batchId)).rejects.toThrow(
            "core cannot retry acquisition",
        );
        expect(await service.listSources(corpus.corpusId)).toHaveLength(1);
        await service.close();
        const legacyFile = path.join(root, "batches", `${batch.batchId}.json`);
        const legacy = JSON.parse(await readFile(legacyFile, "utf8")) as {
            members: Array<{
                title?: string;
                displayName?: string;
                warnings: string[];
            }>;
        };
        delete legacy.members[0].title;
        delete legacy.members[0].displayName;
        legacy.members[0].warnings = ["Ordinary ingestion warning"];
        await writeFile(legacyFile, JSON.stringify(legacy));
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
        expect(
            (await service.findBatchImport(key))?.acquisitionFingerprint,
        ).toBe(request.acquisitionFingerprint);
        expect(
            (await service.listBatchImports(corpus.corpusId))[0].members[1],
        ).toMatchObject({
            clientKey: "selected-file-2",
            state: "failed",
            stage: "acquisition",
            reason: "Acquisition rejected: Unsupported archive",
        });
        expect((await service.findBatchImport(key))?.acquisitionIssues).toEqual(
            request.acquisitionIssues,
        );
        expect((await service.findBatchImport(key))?.members[0].title).toBe(
            "folder\\Guide",
        );
        expect((await service.findBatchImport(key))?.members[0]).toMatchObject({
            displayName: "Guide",
            warnings: [
                "Missing image missing.png requires manual inspection",
                "Ordinary ingestion warning",
            ],
        });
        expect((await service.findBatchImport(key))?.warnings).toEqual(
            request.warnings,
        );
        await expect(
            service.startBatchImport({
                ...request,
                acquisitionFingerprint: assetDigest(
                    Buffer.from("different-selection"),
                ),
            }),
        ).rejects.toThrow("different documents");
        const sourceId = batch.members[0].sourceId;
        if (sourceId === undefined) throw new Error("Expected captured source");
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            sourceId,
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId,
            confirmationToken: preview.confirmationToken,
        });
        expect(
            (await service.getBatchImport(batch.batchId)).acquisitionIssues,
        ).toEqual([request.acquisitionIssues[1]]);
        expect(
            (await service.getBatchImport(batch.batchId)).members[0],
        ).toMatchObject({
            title: "Forgotten source",
            displayName: "Forgotten source",
        });
        expect(
            (await service.getBatchImport(batch.batchId)).members[0].warnings,
        ).toEqual([]);
        expect((await service.getBatchImport(batch.batchId)).warnings).toEqual(
            request.warnings,
        );
    });

    test("issue-only rejections become durable failed members and warnings require known opaque keys", async () => {
        const corpus = await service.createCorpus("issues");
        const request: MemoryBatchImportRequest = {
            corpusId: corpus.corpusId,
            idempotencyKey: "issue-only",
            documents: [],
            acquisitionIssues: [
                {
                    member: "file-1",
                    state: "rejected",
                    reason: "Unsupported file",
                },
            ],
        };
        const accepted = await service.startBatchImport(request);
        const batch = await waitFor(
            () => service.getBatchImport(accepted.batchId),
            (batch) => batch.state !== "running",
        );
        expect(batch).toMatchObject({
            state: "failed",
            acquisitionIssues: request.acquisitionIssues,
            members: [
                {
                    clientKey: "file-1",
                    state: "failed",
                    stage: "acquisition",
                    reason: "Acquisition rejected: Unsupported file",
                },
            ],
        });
        expect(batch.members[0].jobId).toBeUndefined();
        expect(() =>
            assertBatchImportRequest({
                ...request,
                acquisitionIssues: [
                    {
                        member: "private\\file",
                        state: "rejected",
                        reason: "Unsupported",
                    },
                ],
            }),
        ).toThrow("opaque");
        expect(() =>
            assertBatchImportRequest({
                ...request,
                acquisitionIssues: [
                    { member: "unknown", state: "warning", reason: "Warning" },
                ],
            }),
        ).toThrow("known opaque");
        expect(() =>
            assertBatchImportRequest({
                ...request,
                rejectedMembers: [
                    { memberKey: "file-1", reason: "Different reason" },
                ],
            }),
        ).toThrow("Conflicting");
        expect(() =>
            assertBatchImportRequest({
                ...request,
                documentWarnings: [["Warning"]],
            }),
        ).toThrow("correspond");
        expect(() =>
            assertBatchImportRequest({
                ...request,
                warnings: ["x".repeat(1001)],
            }),
        ).toThrow("1000");
        expect(() =>
            assertBatchImportRequest({
                ...request,
                warnings: Array.from({ length: 21 }, () => "Warning"),
            }),
        ).toThrow("20");
    });

    test("concurrent batch admission preserves key identity and validates acquisition fingerprints", async () => {
        const corpus = await service.createCorpus("concurrent-batch");
        const request: MemoryBatchImportRequest = {
            corpusId: corpus.corpusId,
            idempotencyKey: "same-key",
            acquisitionFingerprint: assetDigest(Buffer.from("urls")),
            documents: [
                {
                    source: {
                        sourceType: "markdown",
                        title: "Guide",
                        markdown: content,
                    },
                },
            ],
        };
        expect(() =>
            assertBatchImportRequest({
                ...request,
                acquisitionFingerprint: "invalid",
            }),
        ).toThrow("SHA-256");
        const results = await Promise.allSettled([
            service.startBatchImport(request),
            service.startBatchImport(request),
            service.startBatchImport({
                ...request,
                acquisitionFingerprint: assetDigest(Buffer.from("other-urls")),
            }),
        ]);
        expect(results.map((result) => result.status)).toEqual([
            "fulfilled",
            "fulfilled",
            "rejected",
        ]);
        const first = results[0];
        const duplicate = results[1];
        if (first.status !== "fulfilled" || duplicate.status !== "fulfilled")
            throw new Error("Expected matching batch admissions");
        expect(first.value.batchId).toBe(duplicate.value.batchId);
        await waitFor(
            () => service.getBatchImport(first.value.batchId),
            (batch) => batch.state !== "running",
        );
        expect(await service.listBatchImports(corpus.corpusId)).toHaveLength(1);
    });

    test("rejection-only batches are durable failures, not fake captures or retryable ingest jobs", async () => {
        const corpus = await service.createCorpus("rejections");
        const accepted = await service.startBatchImport({
            corpusId: corpus.corpusId,
            idempotencyKey: "rejected",
            documents: [],
            rejectedMembers: [
                {
                    memberKey: "url-1",
                    displayName: "Page",
                    reason: "Acquisition policy rejected URL",
                },
            ],
        });
        const batch = await waitFor(
            () => service.getBatchImport(accepted.batchId),
            (batch) => batch.state !== "running",
        );
        expect(batch.state).toBe("failed");
        expect(batch.members[0].sourceId).toBeUndefined();
        expect(await service.listSources(corpus.corpusId)).toEqual([]);
        await expect(
            service.startBatchImport({
                corpusId: corpus.corpusId,
                idempotencyKey: "empty",
                documents: [],
            }),
        ).rejects.toThrow("1-50");
        await expect(
            service.startBatchImport({
                corpusId: corpus.corpusId,
                idempotencyKey: "paths",
                documents: [],
                rejectedMembers: [
                    { memberKey: "..\\private", reason: "Rejected" },
                ],
            }),
        ).rejects.toThrow("opaque identifiers");
    });

    test("batch sizing includes encoded asset and UTF-8 overhead at the exact limit", () => {
        const request: MemoryBatchImportRequest = {
            corpusId: "corpus",
            idempotencyKey: "size",
            documents: [
                {
                    source: {
                        sourceType: "markdown",
                        title: "\u00e9",
                        markdown: "",
                        assets: [
                            {
                                name: "screen.png",
                                mimeType: "image/png",
                                bytes: png,
                            },
                        ],
                    },
                },
            ],
            rejectedMembers: [
                { memberKey: "unsupported", reason: "Unsupported archive" },
            ],
        };
        const serialized = JSON.stringify({
            ...request,
            documents: [
                {
                    source: {
                        ...request.documents[0].source,
                        assets: [
                            {
                                name: "screen.png",
                                mimeType: "image/png",
                                bytes: {
                                    batchAssetBytes:
                                        Buffer.from(png).toString("base64"),
                                },
                            },
                        ],
                    },
                },
            ],
        });
        expect(measureBatchImportBytes(request)).toBe(
            Buffer.byteLength(serialized),
        );
        const buffered = structuredClone(request);
        buffered.documents[0].source.assets![0].bytes = Buffer.from(png);
        expect(measureBatchImportBytes(buffered)).toBe(
            measureBatchImportBytes(request),
        );
        expect(measureBatchImportBytes(request)).toBeGreaterThan(
            serialized.length,
        );
        expect(batchImportRequestByteLimit).toBe(8 * 1024 * 1024);
        request.documents[0].source.markdown = "x".repeat(
            batchImportRequestByteLimit - measureBatchImportBytes(request),
        );
        expect(measureBatchImportBytes(request)).toBe(
            batchImportRequestByteLimit,
        );
        expect(() => assertBatchImportRequest(request)).not.toThrow();
        request.documents[0].source.markdown += "x";
        expect(measureBatchImportBytes(request)).toBe(
            batchImportRequestByteLimit + 1,
        );
        expect(() => assertBatchImportRequest(request)).toThrow("within 8 MB");
        expect(request.documents[0].source.assets?.[0].bytes).toEqual(png);
    });

    test("batch partial success, duplicates, key identity, retry, restart and cleanup", async () => {
        const corpus = await service.createCorpus("batch");
        const document = {
            source: {
                sourceType: "markdown" as const,
                title: "Guide",
                markdown: content,
            },
        };
        const request = {
            corpusId: corpus.corpusId,
            idempotencyKey: "first",
            documentWarnings: [
                ["First acquisition warning"],
                ["Duplicate acquisition warning"],
                ["Failed acquisition warning"],
            ],
            documents: [
                document,
                document,
                {
                    source: {
                        sourceType: "markdown" as const,
                        title: "Bad",
                        markdown: "",
                    },
                },
            ],
        };
        const accepted = await service.startBatchImport(request);
        const batch = await waitFor(
            () => service.getBatchImport(accepted.batchId),
            (batch) => batch.state !== "running",
        );
        expect(batch).toMatchObject({ state: "partial" });
        expect(batch.members.map((member) => member.state)).toEqual([
            "complete",
            "duplicate",
            "failed",
        ]);
        expect(batch.members.map((member) => member.title)).toEqual([
            "Guide",
            "Guide",
            "Bad",
        ]);
        expect(batch.members[0].warnings).toContain(
            "First acquisition warning",
        );
        expect(batch.members[1].warnings).toContain(
            "Duplicate acquisition warning",
        );
        expect((await service.startBatchImport(request)).batchId).toBe(
            batch.batchId,
        );
        await expect(
            service.startBatchImport({
                ...request,
                documents: [document],
                documentWarnings: [request.documentWarnings[0]],
            }),
        ).rejects.toThrow("different documents");
        const retried = await service.retryBatchImport(batch.batchId);
        expect(retried.members[0].jobId).toBe(batch.members[0].jobId);
        await waitFor(
            () => service.getBatchImport(batch.batchId),
            (batch) => batch.state !== "running",
        );
        await service.close();
        const file = path.join(root, "batches", `${batch.batchId}.json`);
        const stored = JSON.parse(await readFile(file, "utf8")) as {
            state: string;
            members: Array<{ state: string }>;
        };
        stored.state = "running";
        stored.members[2].state = "pending";
        await writeFile(file, JSON.stringify(stored));
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeProcedureCorpusIndex(directory),
            runbookSynthesizer: async (input) => output(input),
        });
        expect((await service.getBatchImport(batch.batchId)).state).toBe(
            "interrupted",
        );
        await service.clearCorpus(corpus.corpusId);
        expect(await service.listBatchImports(corpus.corpusId)).toEqual([]);
    });
});
