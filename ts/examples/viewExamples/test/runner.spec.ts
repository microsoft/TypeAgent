// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { readFile, rm, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import {
    FileMemoryService,
    waitForMemoryJob,
    type ViewVersion,
    type FileMemoryServiceOptions,
} from "@typeagent/memory-service";
import { main } from "../src/cli.js";
import { originalFixtures } from "../src/fixtures.js";
import { offlineOptions } from "../src/offline.js";
import { digest, parseConstructionPacket } from "../src/packets.js";
import {
    assertOriginalCitations,
    buildBundle,
    claimRunRoot,
    packageRoot,
    runInformational,
    waitForViewBuild,
} from "../src/runner.js";

const roots: string[] = [];
const newRoot = () => {
    const root = path.join(packageRoot, ".test-runs", randomUUID());
    roots.push(root);
    return root;
};
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});

test("packets validate hashes, custody, identifiers, timestamps and query bounds", () => {
    const original = originalFixtures();
    expect(parseConstructionPacket(original).bundles).toHaveLength(12);
    expect(() =>
        parseConstructionPacket({ ...original, purpose: "evaluator-only" }),
    ).toThrow("custody");
    const copy = structuredClone(original);
    copy.bundles[0].sources[0].text += "tampered";
    expect(() => parseConstructionPacket(copy)).toThrow("hash mismatch");
    copy.bundles[0].sources[0].sha256 = digest(copy.bundles[0].sources[0].text);
    copy.bundles[0].query = "a".repeat(201);
    expect(() => parseConstructionPacket(copy)).toThrow("bounds");
});

test("canonical packet identity requires one project brief with exactly its ordered meeting sources", () => {
    const packet = originalFixtures();
    const bundle = packet.bundles.find(
        (entry) => entry.kind === "projectBrief",
    )!;
    bundle.project = {
        id: bundle.id,
        meetingIds: bundle.sources.map((source) => source.id),
    };
    expect(
        parseConstructionPacket(packet).bundles.find(
            (entry) => entry.id === bundle.id,
        )?.project,
    ).toEqual(bundle.project);
    bundle.project.meetingIds.reverse();
    expect(() => parseConstructionPacket(packet)).toThrow("ordered meetings");
    bundle.project.meetingIds.reverse();
    bundle.project.id = "different-project";
    expect(() => parseConstructionPacket(packet)).toThrow(
        "Canonical project identity",
    );
    bundle.project.id = bundle.id;
    bundle.kind = "wiki";
    expect(() => parseConstructionPacket(packet)).toThrow(
        "Canonical project identity",
    );
});

test("canonical projects append meetings to one view with cumulative evidence and retained revision history", async () => {
    const packet = originalFixtures();
    const bundle = packet.bundles.find(
        (entry) => entry.kind === "projectBrief",
    )!;
    bundle.project = {
        id: bundle.id,
        meetingIds: bundle.sources.map((source) => source.id),
    };
    packet.bundles = [bundle];
    const root = newRoot();
    const result = await runInformational({
        packet,
        caseId: bundle.id,
        root,
        mode: "offline",
    });
    expect(result.requests).toHaveLength(3);
    const revisions = result.receipt.revisions;
    if (!revisions)
        throw new Error("Canonical project revision history missing");
    expect(revisions.map((revision) => revision.sourceIds.length)).toEqual([
        1, 2, 3,
    ]);
    expect(new Set(revisions.map((revision) => revision.viewId))).toEqual(
        new Set([bundle.id]),
    );
    expect(new Set(revisions.map((revision) => revision.revisionId)).size).toBe(
        3,
    );
    for (const [index, request] of result.requests.entries())
        expect(request.definition.selector).toMatchObject({
            sources: result.mapping
                .slice(0, index + 1)
                .map(({ sourceId, revisionId }) => ({ sourceId, revisionId })),
        });
    const { service } = await reopen(root);
    try {
        expect(
            (await service.listViews(result.view.corpusId)).views,
        ).toHaveLength(1);
        const current = await service.getView({
            corpusId: result.view.corpusId,
            viewId: bundle.id,
        });
        expect(current?.revisionId).toBe(result.view.revisionId);
        expect(result.receipt.publication.indexState).toBe("absent");
        for (const revision of revisions) {
            const saved = await readFile(
                path.join(
                    root,
                    "revisions",
                    String(revision.sequence).padStart(4, "0"),
                    "saved.json",
                ),
                "utf8",
            );
            expect(digest(saved)).toBe(revision.savedHash);
            const retained = await service.getView({
                corpusId: result.view.corpusId,
                viewId: bundle.id,
                revisionId: revision.revisionId,
            });
            expect(retained?.revisionId).toBe(revision.revisionId);
            await assertOriginalCitations(service, retained!);
        }
    } finally {
        await service.close();
    }
});

test("CLI is offline by default only for help/list and requires an explicit execution mode", async () => {
    expect(await main(["--help"])).toContain(
        "Offline uses deterministic injection",
    );
    expect(await main(["--list"])).toHaveLength(12);
    await expect(
        main(["--case", "capacity-review-wiki", "--root", newRoot()]),
    ).rejects.toThrow("explicit --mode");
    await expect(
        main([
            "--mode",
            "live",
            "--case",
            "capacity-review-wiki",
            "--root",
            newRoot(),
        ]),
    ).rejects.toThrow("--authorization");
});

test("owned roots reject existing roots, source trees, production paths and junctions", async () => {
    await expect(claimRunRoot(packageRoot)).rejects.toThrow("example-local");
    await expect(
        claimRunRoot(path.join(packageRoot, "src", "bad")),
    ).rejects.toThrow("example-local");
    const root = newRoot();
    await claimRunRoot(root);
    await expect(claimRunRoot(root)).rejects.toThrow("already exists");
    const junction = newRoot();
    await mkdir(path.dirname(junction), { recursive: true });
    await symlink(root, junction, "junction");
    await expect(claimRunRoot(path.join(junction, "child"))).rejects.toThrow(
        "junctions",
    );
});

test.each(["wiki", "projectBrief"] as const)(
    "real service builds a draft %s with retained indexed citations and deterministic artifacts",
    async (kind) => {
        const packet = originalFixtures();
        const bundle = packet.bundles.find((entry) => entry.kind === kind)!;
        const root = newRoot();
        const result = await runInformational({
            packet,
            caseId: bundle.id,
            root,
            mode: "offline",
        });
        expect(result.view.content.kind).toBe(kind);
        expect(result.receipt.publication.indexState).toBe("absent");
        expect(result.receipt.publication.publishedRevisionId).toBeUndefined();
        expect(result.receipt.qualityBaseline).toBe(false);
        expect(result.mapping).toHaveLength(3);
        expect(result.requests).toHaveLength(1);
        expect(
            digest(await readFile(path.join(root, "saved.json"), "utf8")),
        ).toBe(result.receipt.savedHash);
        expect(
            digest(await readFile(path.join(root, "rendered.txt"), "utf8")),
        ).toBe(result.receipt.renderedHash);
        expect(
            digest(
                await readFile(
                    path.join(root, "request-evidence.json"),
                    "utf8",
                ),
            ),
        ).toBe(result.receipt.requestHash);
        expect(
            await readFile(path.join(root, "rendered.txt"), "utf8"),
        ).toContain("Capacity review");
        expect(result.view.content.citations.length).toBeGreaterThan(0);
        if (result.view.content.kind === "wiki") {
            expect(result.view.content.index[0].pageId).toBe(
                result.view.content.sections[0].id,
            );
            expect(result.view.content.sections[0].details.taxonomy).toBe(
                "concept",
            );
        } else if (result.view.content.kind === "projectBrief") {
            expect(
                result.view.content.sections.map((section) => section.role),
            ).toEqual([
                "goalsScope",
                "owners",
                "status",
                "milestones",
                "decisions",
                "risks",
                "context",
            ]);
            expect(result.view.content).not.toHaveProperty("openQuestions");
            const owners = result.view.content.sections.find(
                (section) => section.role === "owners",
            )!;
            expect(owners.details).toMatchObject({ assignments: [] });
        }
    },
);

test("disabled capability is explicit and preserves a failure receipt", async () => {
    const root = newRoot();
    await expect(
        runInformational({
            packet: originalFixtures(),
            caseId: "capacity-review-wiki",
            root,
            mode: "offline",
            serviceOptions: { informationalViews: false },
        }),
    ).rejects.toThrow("capability is disabled");
    const failure = JSON.parse(
        await readFile(path.join(root, "failure.json"), "utf8"),
    );
    expect(failure).toMatchObject({
        status: "failed",
        component: "wiki-views",
    });
});

test("live authorization and already-cancelled work fail before owning a store", async () => {
    await expect(
        runInformational({
            packet: originalFixtures(),
            caseId: "capacity-review-wiki",
            root: newRoot(),
            mode: "live",
        }),
    ).rejects.toThrow("explicit non-secret approval");
    const control = new AbortController();
    control.abort(new Error("test cancellation"));
    await expect(
        runInformational({
            packet: originalFixtures(),
            caseId: "capacity-review-wiki",
            root: newRoot(),
            mode: "offline",
            signal: control.signal,
        }),
    ).rejects.toThrow("test cancellation");
});

test("offline mode cannot dispatch a caller-provided model/index and timeout is explicit", async () => {
    await expect(
        runInformational({
            packet: originalFixtures(),
            caseId: "capacity-review-wiki",
            root: newRoot(),
            mode: "offline",
            serviceOptions: {
                indexFactory: () => {
                    throw new Error("Caller index must never execute");
                },
            },
        }),
    ).rejects.toThrow("Offline mode refuses");
    await expect(
        runInformational({
            packet: originalFixtures(),
            caseId: "capacity-review-wiki",
            root: newRoot(),
            mode: "offline",
            timeoutMs: 1,
        }),
    ).rejects.toThrow("Informational run timed out");
});

async function reopen(root: string, options: FileMemoryServiceOptions = {}) {
    const fixture = await offlineOptions();
    const service = new FileMemoryService(path.join(root, "store"), {
        ...fixture.options,
        maintenanceMode: "manual",
        discoveryPolicy: "off",
        automaticKnowledgeDiscovery: false,
        ...options,
    });
    await service.initialize();
    return { service, counters: fixture.counters, options: fixture.options };
}

test.each([true, false])(
    "project editorial repair is bounded and rechecks actual merged output (accepted=%s)",
    async (accepted) => {
        const packet = originalFixtures();
        const bundle = packet.bundles.find(
            (entry) => entry.kind === "projectBrief",
        )!;
        const root = newRoot();
        const initial = await runInformational({
            packet,
            caseId: bundle.id,
            root,
            mode: "offline",
        });
        const { service, options } = await reopen(root);
        try {
            const protectedSummary =
                "Human scope qualification: capacity approval remains unknown.";
            if (accepted) {
                const content = structuredClone(initial.view.content);
                content.summary = protectedSummary;
                await service.saveViewDraft({
                    corpusId: initial.view.corpusId,
                    viewId: initial.view.viewId,
                    expectedVersion: initial.view.version,
                    expectedHead: (
                        await service.listViews(initial.view.corpusId)
                    ).head,
                    definition: {
                        viewId: initial.view.viewId,
                        kind: initial.view.content.kind,
                        selector: initial.view.definition.selector,
                        projectSummary: initial.view.definition.projectSummary!,
                    },
                    content,
                    relationships: initial.view.generation?.relationships ?? [],
                });
            }
            const adapter = options.viewSynthesisAdapter!;
            const generate = adapter.generate.bind(adapter);
            adapter.generate = async (
                ...args: Parameters<typeof adapter.generate>
            ) => {
                const output = await generate(...args);
                const scope = output.content.sections.find(
                    (section) => section.role === "goalsScope",
                );
                if (!scope) throw new Error("Expected project goals and scope");
                scope.body += " Capacity approval remains unknown.";
                return output;
            };
            const checks: Parameters<
                NonNullable<typeof adapter.checkEditorial>
            >[] = [];
            const check: NonNullable<typeof adapter.checkEditorial> = async (
                ...args
            ) => {
                checks.push(args);
                expect(args[1].content.kind).toBe("projectBrief");
                return {
                    safe: accepted && checks.length > 1,
                    failures:
                        accepted && checks.length > 1
                            ? []
                            : ["quantity" as const],
                };
            };
            const repairs: Parameters<
                NonNullable<typeof adapter.repairProjectSummary>
            >[] = [];
            const repair: NonNullable<
                typeof adapter.repairProjectSummary
            > = async (...args) => {
                repairs.push(args);
                return adapter.generate(args[0], args[3]);
            };
            adapter.checkEditorial = check;
            adapter.repairProjectSummary = repair;
            const updated = {
                ...bundle,
                query: `${bundle.query} updated design`,
            };
            const build = buildBundle(
                service,
                initial.view.corpusId,
                updated,
                initial.mapping,
                new AbortController().signal,
            );
            if (accepted) {
                const result = await build;
                expect(result.view.version).toBeGreaterThan(
                    initial.view.version,
                );
                expect(result.view.content.summary).toBe(protectedSummary);
                await assertOriginalCitations(service, result.view);
            } else {
                await expect(build).rejects.toThrow("critical-distinction");
                expect(
                    (
                        await service.getView({
                            corpusId: initial.view.corpusId,
                            viewId: bundle.id,
                        })
                    )?.revisionId,
                ).toBe(initial.view.revisionId);
            }
            expect(repairs).toHaveLength(1);
            expect(checks).toHaveLength(2);
            expect(checks[1][0]).toBe(checks[0][0]);
            expect(repairs[0][0]).toBe(checks[0][0]);
            expect(repairs[0][2]).toEqual({
                safe: false,
                failures: ["quantity"],
            });
        } finally {
            await service.close();
        }
    },
);

test.each(["wiki", "projectBrief"] as const)(
    "%s publication/search survive restart, replacement invalidates old evidence and privacy removal withdraws it",
    async (kind) => {
        const packet = originalFixtures();
        const bundle = packet.bundles.find((entry) => entry.kind === kind)!;
        const root = newRoot();
        const result = await runInformational({
            packet,
            caseId: bundle.id,
            root,
            mode: "offline",
        });
        let { service } = await reopen(root);
        try {
            expect(
                await service.searchViews({
                    corpusId: result.view.corpusId,
                    query: bundle.query,
                    freshness: "current",
                }),
            ).toEqual([]);
            const publication = await service.publishView({
                corpusId: result.view.corpusId,
                viewId: result.view.viewId,
                revisionId: result.view.revisionId,
                expectedVersion: result.view.version,
                expectedHead: (await service.listViews(result.view.corpusId))
                    .head!,
            });
            expect(publication.indexState).toBe("ready");
            expect(publication.indexedRevisionId).toBe(result.view.revisionId);
            await service.close();
            ({ service } = await reopen(root));
            const matches = await service.searchViews({
                corpusId: result.view.corpusId,
                query: bundle.query,
                freshness: "current",
            });
            expect(
                matches.some(
                    (match) => match.view.revisionId === result.view.revisionId,
                ),
            ).toBe(true);
            const mapped = result.mapping[0];
            const replacement = await service.replaceSource({
                corpusId: mapped.corpusId,
                sourceId: mapped.sourceId,
                expectedActiveRevisionId: mapped.revisionId,
                source: {
                    sourceType: "text",
                    title: "Corrected capacity review",
                    text: "Capacity review correction: incident remains closed; capacity validation remains pending owner review.",
                },
                retainRevisionHistory: true,
            });
            expect(
                (await waitForMemoryJob(service, replacement.jobId)).state,
            ).toBe("complete");
            expect(
                await service.getView({
                    corpusId: mapped.corpusId,
                    viewId: result.view.viewId,
                    includeContext: false,
                }),
            ).toBeUndefined();
            expect(
                await service.searchViews({
                    corpusId: mapped.corpusId,
                    query: bundle.query,
                    freshness: "current",
                }),
            ).toEqual([]);
            const sources = result.mapping.map((entry, index) => ({
                sourceId: entry.sourceId,
                revisionId:
                    index === 0 ? replacement.revisionId : entry.revisionId,
            }));
            const refreshed = await buildBundle(
                service,
                mapped.corpusId,
                bundle,
                sources,
                new AbortController().signal,
            );
            expect(refreshed.view.version).toBeGreaterThan(result.view.version);
            await assertOriginalCitations(service, refreshed.view);
            const preview = await service.previewForgetSource(
                mapped.corpusId,
                mapped.sourceId,
            );
            await service.forgetSource({
                corpusId: mapped.corpusId,
                sourceId: mapped.sourceId,
                confirmationToken: preview.confirmationToken,
            });
            expect(
                await service.getSource(mapped.corpusId, mapped.sourceId),
            ).toBeUndefined();
            expect(
                await service.getView({
                    corpusId: mapped.corpusId,
                    viewId: result.view.viewId,
                    includeContext: false,
                }),
            ).toBeUndefined();
        } finally {
            await service.close();
        }
    },
);

test("human summary is protected and family operations retain durable plans without asserting a page quota", async () => {
    const packet = originalFixtures();
    const bundle = packet.bundles[0];
    const root = newRoot();
    const result = await runInformational({
        packet,
        caseId: bundle.id,
        root,
        mode: "offline",
    });
    const { service, options } = await reopen(root);
    try {
        const content = structuredClone(result.view.content);
        content.summary =
            "Human scope qualification: this is an offline review, not deployment approval.";
        const edited = await service.saveViewDraft({
            corpusId: result.view.corpusId,
            viewId: result.view.viewId,
            expectedVersion: result.view.version,
            expectedHead: (await service.listViews(result.view.corpusId)).head,
            definition: {
                viewId: result.view.viewId,
                kind: result.view.content.kind,
                selector: result.view.definition.selector,
                wiki: result.view.definition.wiki!,
            },
            content,
            relationships: result.view.generation?.relationships ?? [],
        });
        expect(
            edited.version.edits?.some((edit) =>
                edit.protection?.includes("summary"),
            ),
        ).toBe(true);
        const adapter = options.viewSynthesisAdapter!;
        const generate = adapter.generate.bind(adapter);
        adapter.generate = async (
            ...args: Parameters<typeof adapter.generate>
        ) => {
            const output = await generate(...args);
            output.content.summary =
                "Capacity review still requires independent owner approval.";
            return output;
        };
        const added = await service.ingestDocument({
            corpusId: result.view.corpusId,
            source: {
                sourceId: "new-qualification",
                sourceType: "text",
                title: "Capacity review qualification",
                text: "Capacity review still requires independent owner approval.",
            },
        });
        expect((await waitForMemoryJob(service, added.jobId)).state).toBe(
            "complete",
        );
        await expect(
            buildBundle(
                service,
                result.view.corpusId,
                bundle,
                [
                    ...result.mapping,
                    { sourceId: added.sourceId, revisionId: added.revisionId },
                ],
                new AbortController().signal,
            ),
        ).rejects.toThrow("conflicted");
        const preserved: ViewVersion | undefined = await service.getView({
            corpusId: result.view.corpusId,
            viewId: result.view.viewId,
            includeContext: false,
        });
        expect(preserved?.content.summary).toBe(content.summary);
        for (const family of ["wiki", "projects"] as const) {
            const pass = await service.maintainViews({
                corpusId: result.view.corpusId,
                expectedHead: (await service.listViews(result.view.corpusId))
                    .head,
                family,
                operation: "update",
            });

            expect(pass.receiptId).toBeTruthy();
            expect(pass.plan).toBeDefined();
            expect(
                await service.getViewMaintenance({
                    corpusId: result.view.corpusId,
                    receiptId: pass.receiptId,
                }),
            ).toBeDefined();
        }
    } finally {
        await service.close();
    }
});

test.each(["intent", "index"] as const)(
    "restart at publication %s preserves the committed revision and retries only indexing",
    async (point) => {
        const packet = originalFixtures();
        const bundle = packet.bundles[0];
        const root = newRoot();
        const result = await runInformational({
            packet,
            caseId: bundle.id,
            root,
            mode: "offline",
        });
        let { service } = await reopen(root, {
            viewPublicationCheckpoint: async (current) => {
                if (current === point)
                    throw new Error(`Controlled interruption: ${point}`);
            },
        });
        try {
            const request = {
                corpusId: result.view.corpusId,
                viewId: result.view.viewId,
                revisionId: result.view.revisionId,
                expectedVersion: result.view.version,
                expectedHead: (await service.listViews(result.view.corpusId))
                    .head!,
            };
            await expect(service.publishView(request)).rejects.toThrow(
                "Controlled interruption",
            );
            const pending = await service.getViewPublication(request);
            expect(pending.indexState).toBe(
                point === "intent" ? "absent" : "pending",
            );
            if (point === "index")
                expect(pending.publishedRevisionId).toBe(
                    result.view.revisionId,
                );
            else expect(pending.publishedRevisionId).toBeUndefined();
            await service.close();
            const reopened = await reopen(root);
            service = reopened.service;
            const repaired = await service.retryViewIndex({
                ...request,
                expectedHead: (await service.listViews(request.corpusId)).head!,
            });
            if (repaired.indexState !== "ready")
                throw new Error(`Index retry failed: ${repaired.reason}`);
            expect(repaired).toMatchObject({
                indexState: "ready",
                indexedRevisionId: result.view.revisionId,
            });
            if (point === "index")
                expect(repaired.intent).toEqual(pending.intent);
            expect(reopened.counters.article).toBe(0);
            expect((await service.getView(request))?.version).toBe(
                result.view.version,
            );
        } finally {
            await service.close();
        }
    },
);

test("family pause/resume/update/rebuild operations retain plans and terminal job dispositions", async () => {
    const packet = originalFixtures();
    const bundle = packet.bundles[0];
    const root = newRoot();
    const result = await runInformational({
        packet,
        caseId: bundle.id,
        root,
        mode: "offline",
    });
    const { service } = await reopen(root);
    try {
        for (const family of ["wiki", "projects"] as const)
            for (const operation of [
                "pause",
                "resume",
                "update",
                "rebuild",
                "pause",
            ] as const) {
                const pass = await service.maintainViews({
                    corpusId: result.view.corpusId,
                    family,
                    operation,
                    expectedHead: (
                        await service.listViews(result.view.corpusId)
                    ).head,
                });
                expect(pass.receiptId).toBeTruthy();
                expect(pass.plan).toBeDefined();
                if (pass.job) {
                    const completed = await waitForViewBuild(
                        service,
                        pass.job,
                        new AbortController().signal,
                    );
                    expect(completed.state).not.toBe("running");
                    expect(
                        completed.results.every((target) =>
                            Boolean(target.reason),
                        ),
                    ).toBe(true);
                }
            }
    } finally {
        await service.close();
    }
});
