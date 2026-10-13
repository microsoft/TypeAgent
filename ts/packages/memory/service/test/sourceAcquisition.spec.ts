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
import {
    assertBatchImportRequest,
    batchImportRequestByteLimit,
    measureBatchImportBytes,
    type MemoryBatchImportRequest,
} from "../src/batchImport.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    RevisionAssetStore,
    assetDigest,
    validateAssetInputs,
} from "../src/revisionAssetStore.js";
import type {
    DocumentIngestRequest,
    IngestionJobStatus,
} from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

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

describe("revision assets and source acquisition", () => {
    let root: string;
    let service: FileMemoryService;
    beforeEach(async () => {
        root = path.resolve(".test-fixtures", `runbook-${randomUUID()}`);
        await mkdir(root, { recursive: true });
        service = new FileMemoryService(root, {
            indexFactory: (_corpus, directory) =>
                new FakeSemanticCorpusIndex(directory),
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
                new FakeSemanticCorpusIndex(directory),
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
                new FakeSemanticCorpusIndex(directory),
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
});
