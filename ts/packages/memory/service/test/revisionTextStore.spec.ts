// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    link,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import {
    RevisionTextStore,
    type RevisionTextFaultPoint,
} from "../src/revisionTextStore.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

interface StoredManifest {
    storageVersion: number;
    pendingCorpusClear?: unknown;
    authorizedSourceRemoval?: unknown;
    sources: Array<{
        sourceId: string;
        revisions: Array<{
            revisionId: string;
            content?: string;
            text: { sha256: string; bytes: number };
        }>;
    }>;
}

describe("canonical revision text", () => {
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;
    let fault: RevisionTextFaultPoint | undefined;

    function open() {
        return new FileMemoryService(root, {
            sourceSynopses: false,
            viewDrafts: false,
            informationalViews: false,
            indexFactory: (_, directory) =>
                new FakeSemanticCorpusIndex(directory),
            revisionTextCheckpoint: async (point) => {
                if (fault === point) {
                    fault = undefined;
                    throw new Error(`Interrupted at ${point}`);
                }
            },
        });
    }

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "revision-text-"));
        fault = undefined;
        service = open();
        ({ corpusId } = await service.createCorpus("Text storage"));
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    async function restart() {
        await service.close();
        service = open();
        await service.initialize();
    }

    async function ingest(sourceId: string, text: string, retain = false) {
        const accepted = await service.ingestDocument({
            corpusId,
            source: { sourceId, sourceType: "text", title: sourceId, text },
            pipeline: {
                updatePolicy: retain
                    ? "retainRevisionHistory"
                    : "replaceActiveRevision",
            },
        });
        return waitForMemoryJob(service, accepted.jobId, { pollIntervalMs: 1 });
    }

    async function seed(sourceId: string, text: string, retain = false) {
        const job = await ingest(sourceId, text, retain);
        expect(job.state).toBe("complete");
        expect(job.error).toBeUndefined();
        return job;
    }

    const manifestFile = () => path.join(root, corpusId, "manifest.json");
    const textDirectory = () => path.join(root, corpusId, "revision-text");
    const manifest = async () =>
        JSON.parse(await readFile(manifestFile(), "utf8")) as StoredManifest;
    const content = (sourceId: string, revisionId?: string) =>
        service.getSourceContent({
            corpusId,
            sourceId,
            ...(revisionId === undefined ? {} : { revisionId }),
            maxChars: 2000,
        });

    async function forget(sourceId: string) {
        const preview = await service.previewForgetSource(corpusId, sourceId);
        return service.forgetSource({
            corpusId,
            sourceId,
            confirmationToken: preview.confirmationToken,
        });
    }

    async function assertNoBytes(
        directory: string,
        secret: string,
    ): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await assertNoBytes(file, secret);
            else
                expect(
                    (await readFile(file)).includes(Buffer.from(secret)),
                ).toBe(false);
        }
    }

    test("stores verified JSON text outside metadata and preserves exact UTF-16 content across restart", async () => {
        const text =
            'retained "quotes" \\ slash\n\uD800 lone \uDFFF \u{1F600} end';
        await seed("first", text);
        const stored = await manifest();
        expect(stored.storageVersion).toBe(1);
        const revision = stored.sources[0].revisions[0];
        expect(revision).not.toHaveProperty("content");
        expect(await readFile(manifestFile(), "utf8")).not.toContain("quotes");
        const bytes = await readFile(
            path.join(textDirectory(), `${revision.text.sha256}.json`),
        );
        expect(bytes.length).toBe(revision.text.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
            revision.text.sha256,
        );
        expect(JSON.parse(bytes.toString("utf8"))).toBe(text);
        await restart();
        expect((await content("first")).content).toBe(text);
        expect(
            (await service.getSource(corpusId, "first"))?.revisions[0],
        ).not.toHaveProperty("text");
    });

    test("one-source replacement never rewrites retained blobs", async () => {
        await seed("retained", "unchanged text");
        await seed("changed", "old text");
        const retained = (await manifest()).sources.find(
            (source) => source.sourceId === "retained",
        )!;
        const file = path.join(
            textDirectory(),
            `${retained.revisions[0].text.sha256}.json`,
        );
        const before = await stat(file);
        await seed("changed", "replacement text");
        const after = await stat(file);
        expect(after.ino).toBe(before.ino);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        expect(await readdir(textDirectory())).toHaveLength(2);
        await restart();
        expect((await content("retained")).content).toBe("unchanged text");
        expect((await content("changed")).content).toBe("replacement text");
    });

    test("deduplicates shared content across sources and retained revisions until the final reference is forgotten", async () => {
        const shared = "private shared revision bytes";
        await seed("first", shared);
        await seed("second", shared);
        const original = (await service.getSource(corpusId, "first"))!
            .activeRevisionId;
        await seed("first", "new first text", true);
        expect(await readdir(textDirectory())).toHaveLength(2);
        await forget("second");
        expect((await content("first", original)).content).toBe(shared);
        expect(await readdir(textDirectory())).toHaveLength(2);
        await restart();
        await forget("first");
        expect(await readdir(textDirectory())).toEqual([]);
        await assertNoBytes(root, shared);
        await restart();
        expect(await service.listSources(corpusId)).toEqual([]);
    });

    test.each<RevisionTextFaultPoint>([
        "blob-written",
        "blob-verified",
        "blob-published",
        "manifest-prepared",
    ])(
        "%s interruption preserves the previous publication and collects unreferenced text on restart",
        async (point) => {
            await seed("first", "previous committed content");
            const before = await readFile(manifestFile(), "utf8");
            fault = point;
            const job = await ingest(
                "first",
                "uncommitted replacement content",
            );
            expect(job.state).toBe("failed");
            expect(job.error).toContain(point);
            expect(await readFile(manifestFile(), "utf8")).toBe(before);
            expect((await content("first")).content).toBe(
                "previous committed content",
            );
            await restart();
            expect(await readdir(textDirectory())).toHaveLength(1);
            expect((await content("first")).content).toBe(
                "previous committed content",
            );
            await seed("first", "uncommitted replacement content");
            expect((await content("first")).content).toBe(
                "uncommitted replacement content",
            );
        },
    );

    test.each<RevisionTextFaultPoint>(["purge-started", "purge-removed"])(
        "source forgetting stays gated after %s and physically completes on restart",
        async (point) => {
            const secret = "uniquely forgotten source bytes";
            await seed("first", secret);
            await seed("retained", "retained unrelated source");
            fault = point;
            await expect(forget("first")).rejects.toThrow(point);
            expect((await manifest()).authorizedSourceRemoval).toBeDefined();
            await expect(content("retained")).rejects.toThrow(
                "pending purge recovery",
            );
            await restart();
            expect((await manifest()).authorizedSourceRemoval).toBeUndefined();
            expect((await content("retained")).content).toBe(
                "retained unrelated source",
            );
            await assertNoBytes(root, secret);
        },
    );

    test.each<RevisionTextFaultPoint>(["purge-started", "purge-removed"])(
        "corpus clear stays gated after %s and physically completes on restart",
        async (point) => {
            const secret = "uniquely cleared corpus bytes";
            await seed("first", secret);
            fault = point;
            await expect(service.clearCorpus(corpusId)).rejects.toThrow(point);
            expect((await manifest()).pendingCorpusClear).toBeDefined();
            await expect(service.listSources(corpusId)).rejects.toThrow(
                "pending purge recovery",
            );
            await restart();
            expect((await manifest()).pendingCorpusClear).toBeUndefined();
            expect(await service.listSources(corpusId)).toEqual([]);
            expect(await readdir(textDirectory())).toEqual([]);
            await assertNoBytes(root, secret);
        },
    );

    test("successful clear purges all text and can accept fresh ingestion", async () => {
        await seed("first", "discarded content");
        expect(await service.clearCorpus(corpusId)).toBe(1);
        expect(await readdir(textDirectory())).toEqual([]);
        await restart();
        await seed("new", "fresh content");
        expect((await content("new")).content).toBe("fresh content");
    });

    test.each(["missing", "digest", "size", "hardlink"])(
        "%s blob damage is explicit and never repaired from derived indexes",
        async (damage) => {
            await seed("first", "canonical text");
            await service.close();
            const stored = await manifest();
            const reference = stored.sources[0].revisions[0].text;
            const file = path.join(textDirectory(), `${reference.sha256}.json`);
            if (damage === "missing") await rm(file);
            else if (damage === "digest")
                await writeFile(file, '"other contents"');
            else if (damage === "size") {
                reference.bytes++;
                await writeFile(manifestFile(), JSON.stringify(stored));
            } else await link(file, path.join(root, "unexpected-hardlink"));
            service = open();
            await expect(service.initialize()).rejects.toThrow(
                damage === "missing"
                    ? "ENOENT"
                    : damage === "hardlink"
                      ? "Unsafe revision text blob"
                      : "Corrupt revision text blob",
            );
            expect(await readFile(manifestFile(), "utf8")).toContain(
                reference.sha256,
            );
        },
    );

    test.each([undefined, 0, 2])(
        "rejects unsupported manifest storage version %s without deleting canonical data",
        async (version) => {
            await seed("first", "retained incompatible-store bytes");
            await service.close();
            const stored = { ...(await manifest()), storageVersion: version };
            const before = JSON.stringify(stored);
            await writeFile(manifestFile(), before);
            service = open();
            await expect(service.initialize()).rejects.toThrow(
                /Unsupported.*reset\/reimport/,
            );
            expect(await readFile(manifestFile(), "utf8")).toBe(before);
            expect(await readdir(textDirectory())).toHaveLength(1);
        },
    );

    test("startup collects abandoned staged and published blobs without a second reference authority", async () => {
        await seed("retained", "legitimately retained bytes");
        await service.close();
        const bytes = Buffer.from(JSON.stringify("abandoned process bytes"));
        const hash = createHash("sha256").update(bytes).digest("hex");
        await writeFile(path.join(textDirectory(), `${hash}.json`), bytes);
        await writeFile(
            path.join(
                textDirectory(),
                `${hash}.00000000-0000-0000-0000-000000000000.tmp`,
            ),
            bytes,
        );
        const abandonedManifest = `${manifestFile()}.00000000-0000-0000-0000-000000000000.staging`;
        await writeFile(
            abandonedManifest,
            JSON.stringify({ title: "abandoned process bytes" }),
        );
        service = open();
        await service.initialize();
        expect(await readdir(textDirectory())).toHaveLength(1);
        await expect(stat(abandonedManifest)).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect((await content("retained")).content).toBe(
            "legitimately retained bytes",
        );
        await assertNoBytes(root, "abandoned process bytes");
    });

    test("text ownership is corpus-local even when two corpora retain identical bytes", async () => {
        const shared = "shared across separate corpora";
        await seed("first", shared);
        const other = await service.createCorpus("Other corpus");
        const accepted = await service.ingestDocument({
            corpusId: other.corpusId,
            source: {
                sourceId: "other",
                sourceType: "text",
                title: "other",
                text: shared,
            },
        });
        expect(
            (
                await waitForMemoryJob(service, accepted.jobId, {
                    pollIntervalMs: 1,
                })
            ).state,
        ).toBe("complete");
        await forget("first");
        expect(await readdir(textDirectory())).toEqual([]);
        await restart();
        expect(
            (
                await service.getSourceContent({
                    corpusId: other.corpusId,
                    sourceId: "other",
                })
            ).content,
        ).toBe(shared);
    });

    test("sharing does not overwrite an existing corrupt canonical blob", async () => {
        await seed("first", "shared canonical text");
        const reference = (await manifest()).sources[0].revisions[0].text;
        const file = path.join(textDirectory(), `${reference.sha256}.json`);
        await writeFile(file, '"damaged bytes"');
        const job = await ingest("second", "shared canonical text");
        expect(job.state).toBe("failed");
        expect(job.error).toContain("Corrupt revision text blob");
        expect(await readFile(file, "utf8")).toBe('"damaged bytes"');
        expect((await manifest()).sources).toHaveLength(1);
    });

    test("an interrupted post-replacement purge cannot leave a cached reference to deleted bytes", async () => {
        await seed("first", "old replaceable content");
        fault = "purge-removed";
        const job = await seed("first", "new replaceable content");
        expect(job.warnings.join(" ")).toContain("purge-removed");
        await seed("first", "old replaceable content");
        await restart();
        expect((await content("first")).content).toBe(
            "old replaceable content",
        );
    });

    test("rejects traversal references before opening any referenced file", async () => {
        const store = new RevisionTextStore(textDirectory());
        await expect(
            store.read({
                sourceId: "first",
                revisionId: "revision",
                contentHash: "hash",
                text: { sha256: "..\\manifest", bytes: 1 },
            }),
        ).rejects.toThrow("Invalid canonical revision text reference");
    });
});
