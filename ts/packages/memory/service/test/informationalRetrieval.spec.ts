// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
    FileMemoryService,
    type FileMemoryServiceOptions,
} from "../src/fileMemoryService.js";
import type {
    ViewBuildSnapshot,
    ViewBuildTarget,
    ViewVersion,
} from "../src/viewTypes.js";
import { viewHash } from "../src/viewMerge.js";
import {
    changeFamily,
    originalFixtureRoot,
} from "./wikiConsolidationFixtures.js";

type Reference = { sourceId: string; revisionId: string };
type MutableSnapshot = ViewBuildSnapshot & {
    informationalRetrieval: {
        indexGeneration: string;
        sources: Reference[];
        followSources: Reference[];
    };
};
type Runtime = {
    manifest: {
        indexGeneration: string;
        sources: Array<{
            sourceId: string;
            activeRevisionId: string;
            revisions: Array<{ revisionId: string; state: string }>;
        }>;
        knowledgeSuppressions?: Array<{ sourceId: string }>;
        authorizedSourceRemoval?: { sourceId: string };
    };
    index: {
        readFragments(request: {
            terms: string[];
            sourceIds: string[];
            followSources?: ReadonlyArray<Reference>;
        }): Promise<{
            fragments: unknown[];
            readChars: number;
            limited: boolean;
        }>;
    };
};
type Inspection = {
    viewStore: {
        getView(request: {
            corpusId: string;
            viewId: string;
        }): Promise<ViewVersion | undefined>;
    };
    getCorpusRuntime(corpusId: string): Promise<Runtime>;
    snapshotInformationalTarget(
        corpusId: string,
        target: ViewBuildTarget,
        current?: ViewVersion,
    ): Promise<ViewBuildSnapshot>;
    recheckViewInput(input: ViewBuildSnapshot): Promise<void>;
};

describe("fresh informational recapture preserves the original retrieval request", () => {
    let root: string;
    let service: FileMemoryService;
    let inspect: Inspection;
    let corpusId: string;
    let runtime: Runtime;
    let target: ViewBuildTarget;
    let counters: Record<string, number>;
    let current: ViewVersion;

    beforeAll(async () => {
        root = await mkdtemp(
            path.join(process.cwd(), ".informational-retrieval-"),
        );
        const toolRoot = new URL(
            "../../../../../tools/memory-maintenance-qualification/",
            import.meta.url,
        );
        const {
            loadPlan,
        }: {
            loadPlan(
                root: string,
            ): Promise<
                Array<{ phase: string; sourceKey: string; file: string }>
            >;
        } = await import(new URL("harness.mjs", toolRoot).href);
        const {
            createOfflineOptions,
        }: {
            createOfflineOptions(
                load: (file: string) => Promise<unknown>,
                counters: Record<string, number>,
                controls: { p6: boolean },
            ): Promise<FileMemoryServiceOptions>;
        } = await import(new URL("offline-models.mjs", toolRoot).href);
        counters = Object.fromEntries(
            [
                "extraction",
                "article",
                "synopsis",
                "topic",
                "assessment",
                "editorial",
                "consolidationPurpose",
                "consolidationActual",
                "validation",
                "unexpectedCompletion",
                "network",
            ].map((key) => [key, 0]),
        );
        const tsRoot = new URL("../../../../../", import.meta.url);
        const options = await createOfflineOptions(
            (file) => import(new URL(file.replaceAll("\\", "/"), tsRoot).href),
            counters,
            { p6: true },
        );
        service = new FileMemoryService(root, {
            ...options,
            sourceSynopses: false,
        });
        inspect = service as unknown as Inspection;
        ({ corpusId } = await service.createCorpus(
            "Actual original 24-source retrieval context",
        ));
        await changeFamily(service, corpusId, "pause");
        for (const family of ["projects", "topics"] as const)
            await service.maintainViews({
                corpusId,
                family,
                operation: "pause",
                expectedHead: (await service.listViews(corpusId)).head,
            });
        const plan = await loadPlan(
            path.resolve(originalFixtureRoot(), "..", ".."),
        );
        const latest = new Map<string, (typeof plan)[number]>();
        for (const entry of plan.filter((entry) => entry.phase !== "t2")) {
            latest.delete(entry.sourceKey);
            latest.set(entry.sourceKey, entry);
        }
        expect(latest.size).toBe(24);
        for (const entry of latest.values()) {
            const job = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: entry.sourceKey,
                    sourceType: "markdown",
                    title: path.basename(entry.file, ".md"),
                    text: await readFile(entry.file, "utf8"),
                },
            });
            for (let tick = 0; tick < 1000; tick++) {
                const saved = await service.getJob(job.jobId);
                if (saved?.state === "failed") throw new Error(saved.error);
                if (saved?.state === "complete") break;
                if (tick === 999)
                    throw new Error("Original indexing did not settle");
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }
        runtime = await inspect.getCorpusRuntime(corpusId);
        target = {
            expectedVersion: 4,
            definition: {
                viewId: "retrieval-probe",
                kind: "wiki",
                selector: {
                    kind: "sources",
                    sources: runtime.manifest.sources.map((source) => ({
                        sourceId: source.sourceId,
                        revisionId: source.activeRevisionId,
                    })),
                },
                wiki: {
                    construction: "informational-wiki-v1",
                    query: "lease",
                    aliases: [],
                    excludedSourceIds: [],
                },
            },
        };
        const prior = await inspect.snapshotInformationalTarget(
            corpusId,
            target,
        );
        const previousSources = [
            "dream-platform",
            "dream-constraints",
            "dream-session-03",
            "sb-capacity-notebook",
        ];
        prior.inputs = await Promise.all(
            previousSources.map(async (sourceId) => {
                const source = runtime.manifest.sources.find(
                    (source) => source.sourceId === sourceId,
                )!;
                const retained = await service.getSourceContent({
                    corpusId,
                    sourceId,
                });
                return {
                    sourceId,
                    revisionId: source.activeRevisionId,
                    title: sourceId,
                    content: String(retained.content),
                    contentHash: viewHash(retained.content),
                };
            }),
        );
        const content: ViewVersion["content"] = {
            kind: "wiki",
            construction: "informational-wiki-v1",
            title: "Prior lease generation",
            sections: [],
            citations: [],
            index: [],
        };
        current = {
            corpusId,
            viewId: target.definition.viewId,
            revisionId: viewHash("prior-target"),
            version: 4,
            state: "draft",
            createdAt: new Date().toISOString(),
            actor: prior.actor,
            provenance: "generated",
            relationships: [],
            content,
            definition: {
                ...structuredClone(target.definition),
                revisionId: viewHash("prior-definition"),
            },
            generation: {
                candidateId: "prior-generation",
                content,
                fingerprint: prior.fingerprint,
                input: prior,
            },
        };
        current.definition.selector.sources = prior.inputs.map(
            ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
        );
        const getView = inspect.viewStore.getView.bind(inspect.viewStore);
        inspect.viewStore.getView = (request) =>
            request.viewId === current.viewId
                ? Promise.resolve(structuredClone(current))
                : getView(request);
    }, 120000);

    afterAll(async () => {
        await service?.close();
        await rm(root, { recursive: true, force: true });
    });

    test("actual 24-source capture with four selected inputs retains completeness and passes the authoritative fresh guard", async () => {
        const input = await inspect.snapshotInformationalTarget(
            corpusId,
            target,
            current,
        );
        expect(input.informationalRetrieval?.sources).toHaveLength(24);
        expect(input.informationalRetrieval?.followSources).toHaveLength(4);
        expect(Object.isFrozen(input.informationalRetrieval)).toBe(true);
        expect(Object.isFrozen(input.informationalRetrieval!.sources)).toBe(
            true,
        );
        expect(input.inputs).toHaveLength(4);
        const index = runtime.index as Runtime["index"] & {
            indexedBlocks(
                memory: unknown,
                scores?: Map<number, number>,
            ): Iterable<{ sourceId: string }>;
        };
        const originalBlocks = index.indexedBlocks;
        let nominees = 0;
        index.indexedBlocks = function* (memory, scores) {
            const blocks = [...originalBlocks.call(this, memory, scores)];
            nominees = blocks.length;
            yield* blocks;
        };
        const selection = await runtime.index.readFragments({
            terms: ["lease"],
            sourceIds: target.definition.selector.sources.map(
                (source) => source.sourceId,
            ),
            followSources: input.informationalRetrieval!.followSources,
        });
        index.indexedBlocks = originalBlocks;
        expect(nominees).toBe(8);
        expect(selection.fragments).toHaveLength(6);
        expect(selection.readChars).toBe(29401);
        expect(selection.limited).toBe(true);
        expect(input.selectionFingerprint).toBe(viewHash(selection));
        const narrowed = await runtime.index.readFragments({
            terms: ["lease"],
            sourceIds: input.inputs.map((source) => source.sourceId),
            followSources: input.informationalRetrieval!.followSources,
        });
        expect(narrowed.fragments).toEqual(selection.fragments);
        expect(narrowed.readChars).toBe(selection.readChars);
        expect(narrowed.limited).toBe(false);
        await expect(inspect.recheckViewInput(input)).resolves.toBeUndefined();
    });

    test("explicit selectors stay narrow and persisted public snapshots retain validated context", async () => {
        const broad = await inspect.snapshotInformationalTarget(
            corpusId,
            target,
            current,
        );
        const scoped = structuredClone(target);
        scoped.definition.selector.sources = broad.inputs.map(
            ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
        );
        const input = await inspect.snapshotInformationalTarget(
            corpusId,
            scoped,
            current,
        );
        expect(input.informationalRetrieval?.sources).toHaveLength(4);
        await expect(inspect.recheckViewInput(input)).resolves.toBeUndefined();
        const { viewBuildJobSchema } = await import(
            new URL("../../../client/dist/viewProtocol.js", import.meta.url)
                .href
        );
        const definition = structuredClone(target.definition);
        definition.viewId = "accepted-retrieval";
        const admit = async () => {
            for (let attempt = 0; attempt < 20; attempt++) {
                try {
                    return await service.buildViews({
                        corpusId,
                        expectedHead: (await service.listViews(corpusId)).head,
                        targets: [{ definition, expectedVersion: 0 }],
                    });
                } catch (error) {
                    if (
                        !(error instanceof Error) ||
                        error.message !==
                            "View history head conflict at build admission"
                    )
                        throw error;
                }
            }
            throw new Error("Optimistic admission did not settle");
        };
        const job = await admit();
        for (let tick = 0; tick < 1000; tick++) {
            const saved = await service.getViewBuild({
                corpusId,
                jobId: job.jobId,
            });
            if (saved?.state !== "running") {
                expect(saved?.state).toBe("complete");
                expect(saved?.results[0].state).toBe("draft");
                const parsed = viewBuildJobSchema.parse(saved);
                expect(
                    parsed.results[0].snapshot.informationalRetrieval,
                ).toEqual(saved?.results[0].snapshot.informationalRetrieval);
                const invalid = structuredClone(saved);
                const altered = invalid!.results[0].snapshot as MutableSnapshot;
                altered.informationalRetrieval.followSources = [
                    { sourceId: "foreign", revisionId: "invalid" },
                ];
                expect(() => viewBuildJobSchema.parse(invalid)).toThrow();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Actual materialization did not settle");
    });

    test.each(["index", "revision", "suppression", "forget"] as const)(
        "%s change in the original retrieval universe is rejected, even outside selected evidence",
        async (change) => {
            const input = await inspect.snapshotInformationalTarget(
                corpusId,
                target,
                current,
            );
            runtime = await inspect.getCorpusRuntime(corpusId);
            const excluded = runtime.manifest.sources.find(
                (source) =>
                    !input.inputs.some(
                        (item) => item.sourceId === source.sourceId,
                    ),
            )!;
            const original = structuredClone(runtime.manifest);
            try {
                if (change === "index")
                    runtime.manifest.indexGeneration = "changed-index";
                if (change === "revision")
                    excluded.activeRevisionId = "changed-revision";
                if (change === "suppression")
                    runtime.manifest.knowledgeSuppressions = [
                        { sourceId: excluded.sourceId },
                    ];
                if (change === "forget")
                    runtime.manifest.authorizedSourceRemoval = {
                        sourceId: excluded.sourceId,
                    };
                await expect(inspect.recheckViewInput(input)).rejects.toThrow(
                    /Informational retrieval|pending purge recovery/,
                );
            } finally {
                Object.assign(runtime.manifest, original);
                delete runtime.manifest.knowledgeSuppressions;
                delete runtime.manifest.authorizedSourceRemoval;
            }
        },
    );

    test.each(["query", "exclusion", "membership", "following"] as const)(
        "%s request change cannot normalize away the fingerprint guard",
        async (change) => {
            const input = structuredClone(
                await inspect.snapshotInformationalTarget(
                    corpusId,
                    target,
                    current,
                ),
            ) as MutableSnapshot;

            if (change === "query")
                input.definition.wiki!.aliases.push("command");
            if (change === "exclusion")
                input.definition.wiki!.excludedSourceIds.push(
                    input.inputs[0].sourceId,
                );
            if (change === "membership")
                input.informationalRetrieval!.sources.pop();
            if (change === "following")
                input.informationalRetrieval!.followSources.push(
                    input.informationalRetrieval!.sources[0],
                );
            await expect(inspect.recheckViewInput(input)).rejects.toThrow(
                /changed during generation|Informational retrieval/,
            );
        },
    );

    test.each(["head", "definition", "protection"] as const)(
        "%s changes remain authoritative during fresh recapture",
        async (change) => {
            const input = await inspect.snapshotInformationalTarget(
                corpusId,
                target,
                current,
            );
            const original = structuredClone(current);
            try {
                if (change === "head")
                    current.revisionId = viewHash("changed target head");
                if (change === "definition")
                    current.definition.revisionId = viewHash(
                        "changed definition head",
                    );
                if (change === "protection")
                    current.edits = [
                        {
                            id: "protected-title",
                            target: "title",
                            actor: current.actor,
                            createdAt: current.createdAt,
                            oldHash: viewHash(current.content.title),
                            operation: "set",
                            status: "active",
                            protection: ["title"],
                        },
                    ];
                await expect(inspect.recheckViewInput(input)).rejects.toThrow(
                    "changed during generation",
                );
            } finally {
                current = original;
            }
        },
    );

    test("recipe fixture retries only the exact cross-module optimistic admission error", async () => {
        class ViewBuildStaleError extends Error {}
        let attempts = 0;
        const fixture = {
            listViews: async () => ({ head: "head" }),
            maintainViews: async () => {
                if (++attempts === 1)
                    throw new ViewBuildStaleError(
                        "Wiki-family history head changed",
                    );
                return "accepted";
            },
        };
        await expect(
            changeFamily(
                fixture as unknown as FileMemoryService,
                corpusId,
                "update",
            ),
        ).resolves.toBe("accepted");
        expect(attempts).toBe(2);
        fixture.maintainViews = async () => {
            throw new Error("Wiki-family history head changed");
        };
        await expect(
            changeFamily(
                fixture as unknown as FileMemoryService,
                corpusId,
                "update",
            ),
        ).rejects.toThrow("Wiki-family history head changed");
    });

    test("legacy persisted captures fail with an explicit rebuild diagnostic rather than silently broadening", async () => {
        const input = await inspect.snapshotInformationalTarget(
            corpusId,
            target,
            current,
        );
        delete input.informationalRetrieval;
        const { fingerprint: _fingerprint, ...legacy } = input;
        input.fingerprint = viewHash(legacy);
        const narrow = await runtime.index.readFragments({
            terms: ["lease"],
            sourceIds: input.inputs.map((item) => item.sourceId),
            followSources: current.generation!.input!.inputs.map(
                ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
            ),
        });
        input.selectionFingerprint = viewHash({
            ...narrow,
            limited: !narrow.limited,
        });
        const { fingerprint: _priorFingerprint, ...mismatched } = input;
        input.fingerprint = viewHash(mismatched);
        await expect(inspect.recheckViewInput(input)).rejects.toThrow(
            "Legacy informational snapshot lacks original retrieval context",
        );
        expect(counters.unexpectedCompletion).toBe(0);
        expect(counters.network).toBe(0);
    });

    test("forget erases metadata-only references from surviving versions and denies the old scope", async () => {
        const before = (await service.getView({
            corpusId,
            viewId: "accepted-retrieval",
        }))!;
        const input = before.generation!.input!;
        const pending = await inspect.snapshotInformationalTarget(
            corpusId,
            {
                definition: {
                    ...structuredClone(target.definition),
                    viewId: before.viewId,
                },
                expectedVersion: before.version,
            },
            before,
        );
        await expect(
            inspect.recheckViewInput(pending),
        ).resolves.toBeUndefined();
        const original = input.informationalRetrieval!.sources.find(
            (source) =>
                !input.inputs.some(
                    (retained) => retained.sourceId === source.sourceId,
                ) &&
                !current.generation!.input!.inputs.some(
                    (retained) => retained.sourceId === source.sourceId,
                ),
        )!;
        const preview = await service.previewForgetSource(
            corpusId,
            original.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: original.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        const after = (await service.getView({
            corpusId,
            viewId: before.viewId,
        }))!;
        expect(after.revisionId).toBe(before.revisionId);
        expect(after.generation!.input!.informationalRetrieval).toBeUndefined();
        for (const entry of await service.getViewHistory({
            corpusId,
            viewId: before.viewId,
        }))
            expect(
                entry.version.generation?.input?.informationalRetrieval,
            ).toBeUndefined();
        await expect(inspect.recheckViewInput(pending)).rejects.toThrow(
            /Informational retrieval|unavailable|changed/,
        );
    });
});
