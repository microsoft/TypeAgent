// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CorpusAccess } from "../src/corpusAccess.js";
import { ViewHistory } from "../src/viewHistory.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import type {
    ViewBuildJob,
    ViewPublishRequest,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";
import type { IndexedDocument } from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { inventoryTestAnswer } from "./viewInventoryTestModel.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: {
        ...actual.openai,
        createChatModel: () => ({
            complete: async (
                messages: Array<{ role: string; content: string }>,
                _usage: unknown,
                schema: { name: string },
            ) => {
                const message = messages.find((entry) => entry.role === "user");
                if (!message) throw new Error("Missing fixture model input");
                return {
                    success: true,
                    data: JSON.stringify(
                        inventoryTestAnswer(
                            schema.name,
                            JSON.parse(message.content),
                        ),
                    ),
                };
            },
        }),
    },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");
const { TypedViewStore } = await import("../src/viewStore.js");

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

async function within<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Concurrent operation blocked")),
                    2_000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

describe("detached view index preparation", () => {
    let root: string;
    let service: InstanceType<typeof FileMemoryService>;
    let corpusId: string;
    let request: ViewPublishRequest;
    let gate: ReturnType<typeof block> | undefined;
    let failure: boolean;
    let directories: string[];
    let releases: Array<() => void>;

    const open = () =>
        new FileMemoryService(root, {
            informationalViews: false,
            discoveryPolicy: "off",
            indexFactory: (_id, directory) =>
                new (class extends FakeSemanticCorpusIndex {
                    public override async rebuild(
                        documents: IndexedDocument[],
                        signal?: AbortSignal,
                    ) {
                        if (
                            documents.some(
                                (document) =>
                                    document.source.sourceId === "guide",
                            )
                        ) {
                            directories.push(directory);
                            const pending = gate;
                            gate = undefined;
                            if (pending) {
                                // Deliberately ignore cancellation: privacy operations must
                                // drain a provider that finishes writing after abort.
                                pending.entered.resolve();
                                const aborted = () =>
                                    pending.cancelled.resolve();
                                signal?.addEventListener("abort", aborted, {
                                    once: true,
                                });
                                try {
                                    await pending.resume.promise;
                                } finally {
                                    signal?.removeEventListener(
                                        "abort",
                                        aborted,
                                    );
                                }
                            }
                            if (failure)
                                throw new Error(
                                    "Controlled derivative failure",
                                );
                            const segments = path.join(
                                path.dirname(directory),
                                ".segments",
                            );
                            await mkdir(segments, { recursive: true });
                            await writeFile(
                                path.join(segments, "controlled-segment"),
                                "Derived evidence",
                            );
                        }
                        await super.rebuild(documents);
                    }
                })(directory),
        });

    beforeEach(async () => {
        root = await mkdtemp(
            path.join(process.cwd(), ".view-index-concurrency-"),
        );
        directories = [];
        releases = [];
        gate = undefined;
        failure = false;
        service = open();
        corpusId = (await service.createCorpus("Index concurrency")).corpusId;
        const admitted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "evidence",
                sourceType: "text",
                title: "Evidence",
                text: "Inspect pressure. Preserve approval boundaries. No verified resolution.",
            },
        });
        expect((await waitForMemoryJob(service, admitted.jobId)).state).toBe(
            "complete",
        );
        const job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            publication: false,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "guide",
                        kind: "troubleshootingGuide",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: admitted.sourceId,
                                    revisionId: admitted.revisionId,
                                },
                            ],
                        },
                    },
                },
            ],
        });
        expect((await wait(job)).results[0].state).toBe("draft");
        request = await publicationRequest();
    });
    afterEach(async () => {
        for (const release of releases) release();
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    function block() {
        const pending = {
            entered: deferred(),
            resume: deferred(),
            cancelled: deferred(),
        };
        gate = pending;
        releases.push(pending.resume.resolve);
        return pending;
    }
    async function wait(job: ViewBuildJob): Promise<ViewBuildJob> {
        for (let attempt = 0; attempt < 500; attempt++) {
            const current = await service.getViewBuild(job);
            if (!current) throw new Error("Missing build");
            if (current.state !== "running") return current;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Build did not finish");
    }
    async function publicationRequest(): Promise<ViewPublishRequest> {
        const snapshot = await service.listViews(corpusId);
        const current = snapshot.views.find((view) => view.viewId === "guide")!;
        return {
            corpusId,
            viewId: current.viewId,
            revisionId: current.revisionId,
            expectedVersion: current.version,
            expectedHead: snapshot.head!,
        };
    }
    async function stagedFiles() {
        return readdir(
            path.join(root, corpusId, "views", "view-search-index-staging"),
        );
    }
    function publish() {
        // Attach rejection handling before concurrent cancellation can settle it.
        return service.publishView(request).then(
            (value) => ({ value, error: undefined }),
            (error: unknown) => ({ value: undefined, error }),
        );
    }
    async function edit() {
        const snapshot = await service.listViews(corpusId);
        const current = snapshot.views[0];
        const content = structuredClone(
            current.content,
        ) as ViewSynthesisOutput["content"];
        content.sections[0].body += " Carefully.";
        return service.saveViewDraft({
            corpusId,
            viewId: current.viewId,
            expectedHead: snapshot.head,
            expectedVersion: current.version,
            definition: {
                viewId: current.viewId,
                kind: "troubleshootingGuide",
                selector: current.definition.selector,
            },
            content,
            relationships: authoredRelationships(current),
        });
    }

    async function rebuild() {
        const snapshot = await service.listViews(corpusId);
        const current = snapshot.views[0];
        return service.buildViews({
            corpusId,
            expectedHead: snapshot.head,
            publication: true,
            targets: [
                {
                    expectedVersion: current.version,
                    definition: {
                        viewId: current.viewId,
                        kind: "troubleshootingGuide",
                        selector: current.definition.selector,
                    },
                },
            ],
        });
    }

    test("legacy view history receives one committed read projection on restart", async () => {
        await service.close();
        const history = new ViewHistory(
            path.join(root, corpusId, "views"),
            () => ({ views: {} }),
        );
        const { head, state } = await history.read();
        const legacyHead = await history.commit(
            head,
            state,
            {},
            "fixture",
            "Legacy state without read entries",
        );
        expect(
            (await new TypedViewStore(root).getViewVersions(request)).map(
                (version) => version.revisionId,
            ),
        ).toContain(request.revisionId);
        service = open();
        expect(await service.getView(request)).toBeDefined();
        const projection = await history.readEntry<{
            views: Array<{ viewId: string }>;
        }>("view-read-projection.json");
        expect(projection.head).not.toBe(legacyHead);
        expect(projection.value?.views.map((view) => view.viewId)).toEqual([
            "guide",
        ]);
        await service.close();
        service = open();
        expect(await service.getView(request)).toBeDefined();
        expect(
            (await history.readEntry("view-read-projection.json")).head,
        ).toBe(projection.head);
    });

    test("detail and inventory reads do not wait for the delayed full-history adapter", async () => {
        const entered = deferred();
        const resume = deferred();
        const original = ViewHistory.prototype.read;
        const read = jest
            .spyOn(ViewHistory.prototype, "read")
            .mockImplementation(async function (
                this: ViewHistory<unknown>,
                ...args
            ) {
                entered.resolve();
                await resume.promise;
                return original.apply(this, args);
            });

        let slow: ReturnType<typeof service.listViewBuilds> | undefined;
        try {
            slow = service.listViewBuilds(corpusId);
            await within(entered.promise);
            expect(await within(service.getView(request))).toBeDefined();
            expect(
                (await within(service.listViews(corpusId))).views,
            ).toHaveLength(1);
            expect(
                (await within(service.listViewSummaries({ corpusId }))).items,
            ).toHaveLength(1);
            expect(
                (await within(service.listViewBuildSummaries({ corpusId })))
                    .items,
            ).toHaveLength(1);
            await within(
                service.getQuestion({
                    corpusId,
                    viewId: "guide",
                    slotId: "missing",
                }),
            );
            await within(service.listQuestions(corpusId));
            await within(service.getViewPublication(request));
        } finally {
            resume.resolve();
            await slow;
            read.mockRestore();
        }
    });

    test("view, question and source detail reads finish while the index provider remains blocked", async () => {
        const pending = block();
        const publication = publish();
        await within(pending.entered.promise);
        expect(await within(service.getView(request))).toBeDefined();
        expect(
            await within(
                service.getQuestion({
                    corpusId,
                    viewId: "guide",
                    slotId: "missing",
                }),
            ),
        ).toBeUndefined();
        expect(
            await within(service.getSource(corpusId, "evidence")),
        ).toBeDefined();
        expect((await within(service.listViews(corpusId))).views).toHaveLength(
            1,
        );
        pending.resume.resolve();
        expect((await publication).value?.indexState).toBe("ready");
        expect(await stagedFiles()).toEqual([]);
        expect(directories[0]).toContain("view-search-index-staging");
    });

    test("an edited and superseding publication cannot install an older prepared index", async () => {
        const pending = block();
        const older = publish();
        await within(pending.entered.promise);
        await within(edit());
        const newer = await service.publishView(await publicationRequest());
        expect(newer.indexState).toBe("ready");
        pending.resume.resolve();
        expect((await older).error).toBeInstanceOf(Error);
        expect(
            (await service.getViewPublication(request)).publishedRevisionId,
        ).toBe(newer.publishedRevisionId);
        expect(await stagedFiles()).toEqual([]);
    });

    test("replacing source evidence rejects stale completion without installing bytes", async () => {
        const pending = block();
        const publication = publish();
        await within(pending.entered.promise);
        const replacement = await within(
            service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "evidence",
                    sourceType: "text",
                    title: "Replacement",
                    text: "Changed diagnostic evidence.",
                },
            }),
        );
        expect(
            (await within(waitForMemoryJob(service, replacement.jobId))).state,
        ).toBe("complete");
        pending.resume.resolve();
        expect((await publication).error).toBeInstanceOf(Error);
        expect(await stagedFiles()).toEqual([]);
        expect((await service.getViewPublication(request)).indexState).not.toBe(
            "ready",
        );
    });

    test("automatic materialization awaits the detached index and records an exact ready receipt", async () => {
        const pending = block();
        const job = await rebuild();
        await within(pending.entered.promise);
        await within(service.getView({ corpusId, viewId: "guide" }));
        await within(service.listQuestions(corpusId));
        await within(service.getSource(corpusId, "evidence"));
        expect((await service.getViewBuild(job))?.state).toBe("running");
        pending.resume.resolve();
        const complete = await wait(job);
        expect(complete.results[0]).toMatchObject({
            state: "searchable",
            publication: { indexState: "ready" },
        });
        expect(complete.results[0].publication?.publishedRevisionId).toBe(
            complete.results[0].revisionId,
        );
    });

    test("cancelling an automatically publishing build cannot install or record a ready receipt", async () => {
        const pending = block();
        const job = await rebuild();
        await within(pending.entered.promise);
        expect((await within(service.cancelViewBuild(job))).state).toBe(
            "cancelled",
        );
        await within(pending.cancelled.promise);
        pending.resume.resolve();
        await within(service.close());
        expect(await stagedFiles()).toEqual([]);
        service = open();
        const cancelled = await service.getViewBuild(job);
        expect(cancelled?.state).toBe("cancelled");
        expect(cancelled?.results[0].publication?.indexState).not.toBe("ready");
        expect(
            (await service.getViewPublication({ corpusId, viewId: "guide" }))
                .indexState,
        ).not.toBe("ready");
    });

    test.each(["source", "events", "corpus", "close"] as const)(
        "%s removal drains an abort-ignoring provider outside the write lease and prevents resurrection",
        async (kind) => {
            const event =
                kind === "events"
                    ? await service.appendEvent({
                          corpusId,
                          idempotencyKey: "removed-event",
                          producer: {
                              producerId: "fixture",
                              producerType: "test",
                          },
                          eventType: "observation",
                          sourceKind: "conversation",
                          content: "Linked diagnostic observation",
                          linkedSourceIds: ["evidence"],
                      })
                    : undefined;
            const preview =
                kind === "source"
                    ? await service.previewForgetSource(corpusId, "evidence")
                    : undefined;
            request = await publicationRequest();
            const pending = block();
            const publication = publish();
            await within(pending.entered.promise);
            let finished = false;
            const removal = (
                kind === "source"
                    ? service.forgetSource({
                          corpusId,
                          sourceId: "evidence",
                          confirmationToken: preview!.confirmationToken,
                      })
                    : kind === "events"
                      ? service.forgetEvents({
                            corpusId,
                            eventIds: [event!.event.eventId],
                            forgetLinkedSources: true,
                        })
                      : kind === "corpus"
                        ? service.clearCorpus(corpusId)
                        : service.close()
            ).then(() => {
                finished = true;
            });
            let repeatedCloseFinished = false;
            const repeatedClose =
                kind === "close"
                    ? service.close().then(() => {
                          repeatedCloseFinished = true;
                      })
                    : undefined;
            await within(pending.cancelled.promise);
            expect(finished).toBe(false);
            if (kind === "close") expect(repeatedCloseFinished).toBe(false);
            if (kind !== "close" && kind !== "source")
                await within(service.listViews(corpusId));
            pending.resume.resolve();
            await within(removal);
            await repeatedClose;
            expect((await publication).error).toBeInstanceOf(Error);
            expect(await stagedFiles()).toEqual([]);
            if (kind !== "close") {
                expect(await service.getView(request)).toBeUndefined();
                expect(
                    (await service.listViewSummaries({ corpusId })).items,
                ).toHaveLength(0);
            }
            const indexRoot = path.join(
                root,
                corpusId,
                "views",
                "view-search-index",
            );
            const installed = await readdir(indexRoot).catch(
                (error: NodeJS.ErrnoException) => {
                    if (error.code === "ENOENT") return [];
                    throw error;
                },
            );
            expect(installed).toEqual([]);
        },
    );

    test("concurrent exact-revision retries share preparation without deadlocking or publishing stale status", async () => {
        const pending = block();
        const publication = publish();
        await within(pending.entered.promise);
        const retry = service.retryViewIndex(await publicationRequest());
        await within(service.getViewPublication(request));
        pending.resume.resolve();
        expect((await publication).value?.indexState).toBe("ready");
        expect((await retry).indexState).toBe("ready");
        expect(directories).toHaveLength(1);
        expect(await stagedFiles()).toEqual([]);
    });

    test("an older still-published revision can be retried after a newer draft without allowing historical publication", async () => {
        failure = true;
        const published = await service.publishView(request);
        expect(published.indexState).toBe("failed");
        failure = false;
        const newer = await edit();
        const retryRequest = {
            ...(await publicationRequest()),
            revisionId: published.publishedRevisionId!,
        };
        await expect(service.publishView(retryRequest)).rejects.toThrow(
            "Publication head or target revision conflict",
        );
        const ready = await service.retryViewIndex(retryRequest);
        expect(ready.indexState).toBe("ready");
        expect(ready.publishedRevisionId).toBe(published.publishedRevisionId);
        expect(ready.indexedRevisionId).toBe(published.publishedRevisionId);
        expect(
            (await service.getView({ corpusId, viewId: "guide" }))?.revisionId,
        ).toBe(newer.version.revisionId);
        expect(await stagedFiles()).toEqual([]);
    });

    test("failure is explicit and exact-revision retry is idempotent", async () => {
        failure = true;
        expect((await service.publishView(request)).indexState).toBe("failed");
        expect(await stagedFiles()).toEqual([]);
        failure = false;
        request = await publicationRequest();
        expect((await service.retryViewIndex(request)).indexState).toBe(
            "ready",
        );
        request = await publicationRequest();
        expect((await service.retryViewIndex(request)).indexState).toBe(
            "ready",
        );
        expect(await stagedFiles()).toEqual([]);
    });

    test("restart removes abandoned staging bytes and retries pending intent", async () => {
        await service.close();
        const abandoned = path.join(
            root,
            corpusId,
            "views",
            "view-search-index-staging",
            "abandoned",
        );
        await mkdir(abandoned, { recursive: true });
        await writeFile(
            path.join(abandoned, "private-content"),
            "Abandoned derived bytes",
        );
        service = open();
        await service.initialize();
        await expect(readdir(abandoned)).rejects.toThrow();
        request = await publicationRequest();
        expect((await service.publishView(request)).indexState).toBe("ready");
    });
});

test("exclusive writers reacquire behind admitted reads and idle drains suspended preparations", async () => {
    const access = new CorpusAccess();
    const preparation = deferred();
    const entered = deferred();
    const reader = deferred();
    const readEntered = deferred();
    const order: string[] = [];
    const write = access.write(async () => {
        order.push("prepare");
        await access.outsideWrite(async () => {
            entered.resolve();
            await preparation.promise;
        });
        order.push("install");
    });
    await entered.promise;
    const read = access.read(async () => {
        readEntered.resolve();
        await reader.promise;
        order.push("read");
    });
    await readEntered.promise;
    let idle = false;
    const draining = access.idle().then(() => {
        idle = true;
    });
    preparation.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["prepare"]);
    expect(idle).toBe(false);
    reader.resolve();
    await within(Promise.all([write, read, draining]));
    expect(order).toEqual(["prepare", "read", "install"]);
});

test("failed detached preparation reacquires exclusivity before caller cleanup", async () => {
    const access = new CorpusAccess();
    const preparation = deferred();
    const entered = deferred();
    const writerEntered = deferred();
    const writerResume = deferred();
    const order: string[] = [];
    const failure = new Error("Detached provider failed");
    const first = access
        .write(async () => {
            try {
                await access.outsideWrite(async () => {
                    entered.resolve();
                    await preparation.promise;
                    throw failure;
                });
            } finally {
                order.push("cleanup");
            }
        })
        .catch((error: unknown) => error);
    await entered.promise;
    const second = access.write(async () => {
        writerEntered.resolve();
        await writerResume.promise;
        order.push("other writer");
    });
    await writerEntered.promise;
    preparation.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);
    writerResume.resolve();
    expect(await within(first)).toBe(failure);
    await within(second);
    expect(order).toEqual(["other writer", "cleanup"]);
    await expect(access.outsideWrite(async () => undefined)).rejects.toThrow(
        "requires an exclusive writer",
    );
});
