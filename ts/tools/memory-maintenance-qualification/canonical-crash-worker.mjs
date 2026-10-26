// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createOfflineOptions } from "./offline-models.mjs";
import {
    installP6Options,
    installCanonicalCrash,
    verifyConsolidation,
    installOfflineTrace,
    installStoreTrace,
} from "./p6-preflight.mjs";
import {
    assertCheckpoint,
    checkpointExpectationHash,
    closeOwnedService,
    snapshotCompiledCheckpoint,
    writeJson,
} from "./harness.mjs";
import { publicRoundTrip } from "./public-roundtrip.mjs";

assert.equal(process.argv[2], "--spec");
const spec = JSON.parse(await readFile(process.argv[3], "utf8"));
const root = path.resolve(spec.runDirectory);
const mode = spec.probeMode;
assert.ok(["crash", "recover", "repeat", "timing"].includes(mode));
const product = path.resolve(import.meta.dirname, "..", "..");
assert.equal(path.resolve(spec.productRoot), product);
const compiledHashes = await snapshotCompiledCheckpoint(product);
if (mode !== "timing" || spec.expectedCheckpoint)
    assertCheckpoint(compiledHashes, spec.expectedCheckpoint);
const compiledHashesHash = createHash("sha256")
    .update(JSON.stringify(compiledHashes))
    .digest("hex");
const load = (relative) =>
    import(pathToFileURL(path.join(product, relative)).href);
const { FileMemoryService } = await load(
    "packages\\memory\\service\\dist\\fileMemoryService.js",
);
const { TypedViewStore } = await load(
    "packages\\memory\\service\\dist\\viewStore.js",
);
const { waitForMemoryJob } = await load(
    "packages\\memory\\service\\dist\\rpcFacade.js",
);
const receiptPath = path.join(root, "receipt.json");
const receipt =
    mode === "crash" || mode === "timing"
        ? {
              phase: "initial",
              actions: {},
              outcome: "RUNNING",
              root,
              counters: {
                  extraction: 0,
                  article: 0,
                  topic: 0,
                  synopsis: 0,
                  assessment: 0,
                  editorial: 0,
                  network: 0,
                  unexpectedCompletion: 0,
                  unexpectedValidation: 0,
              },
          }
        : JSON.parse(await readFile(receiptPath, "utf8"));
receipt.workers ??= [];
receipt.workers.push({ mode, pid: process.pid, startedEpochMs: Date.now() });
receipt.checkpointGuard = {
    expectation: spec.expectedCheckpoint?.name,
    checkpointExpectationHash: spec.expectedCheckpoint
        ? checkpointExpectationHash(spec.expectedCheckpoint)
        : undefined,
    compiledHashesHash,
    compiledFiles: Object.keys(compiledHashes).length,
    admissionVerified: !!spec.expectedCheckpoint,
};
receipt.mechanismScope = {
    sources: "Only original vocabulary initial → T1 via normal APIs",
    topics: "paused",
    projects: "paused",
    sourceSynopses: "disabled in this distinct mechanism corpus only",
    naturalFullCorpusCanonical: "NOT_EXERCISED by this separate mechanism",
};
const persist = () => writeJson(receiptPath, receipt);
const verifyFrozenCheckpoint = async () => {
    const after = await snapshotCompiledCheckpoint(product);
    assert.deepEqual(after, compiledHashes, "Canonical checkpoint changed");
    receipt.checkpointGuard.afterVerified = true;
    receipt.checkpointGuard.afterCompiledHashesHash = createHash("sha256")
        .update(JSON.stringify(after))
        .digest("hex");
};
await persist();
const nativeFetch = globalThis.fetch;
const priorEmbedding = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
globalThis.fetch = async () => {
    receipt.counters.network++;
    throw new Error(
        "Offline isolated canonical crash worker prohibits network",
    );
};
const controls = {
    p6: true,
    recoveringConsolidation: receipt.actions.crash?.consolidation,
};
if (mode === "timing")
    controls.onEvent = (event, edge, data) =>
        appendFileSync(
            path.join(root, "phase-events.jsonl"),
            JSON.stringify({
                epochMs: Date.now(),
                pid: process.pid,
                event,
                edge,
                ...data,
            }) + "\n",
        );
let service;
let restore;
let restoreTrace;
let deadline;
try {
    const options = await createOfflineOptions(
        load,
        receipt.counters,
        controls,
    );
    await installP6Options(options, load, receipt.counters, controls);
    if (mode === "timing") {
        installOfflineTrace(options, controls);
        restoreTrace = installStoreTrace(TypedViewStore, controls);
        options.viewPublicationCheckpoint = async (point) =>
            controls.onEvent("publication", point, {});
        receipt.codeVersion = {
            label: "Verified19:38 C5/source-following + multi-page schema; BEFORE authorized C1 repair",
            modules: Object.fromEntries(
                await Promise.all(
                    [
                        "packages\\memory\\service\\dist\\fileMemoryService.js",
                        "packages\\memory\\service\\dist\\knowProCorpusIndex.js",
                        "packages\\memory\\service\\dist\\viewBuilds.js",
                        "packages\\memory\\service\\dist\\viewStore.js",
                    ].map(async (relative) => [
                        relative,
                        createHash("sha256")
                            .update(
                                await readFile(path.join(product, relative)),
                            )
                            .digest("hex"),
                    ]),
                ),
            ),
        };
    }
    options.sourceSynopses = false;
    delete options.sourceSynopsisModel;
    if (mode === "crash")
        restore = installCanonicalCrash(
            TypedViewStore,
            controls,
            receipt,
            persist,
            async (crash) => {
                await verifyFrozenCheckpoint();
                await persist();
                return writeFile(
                    path.join(root, "crash-receipt.json"),
                    JSON.stringify(crash, null, 2),
                );
            },
        );
    const store = path.join(root, "store");
    service = new FileMemoryService(store, options);
    await service.initialize();
    const admittedEpochMs = Date.now();
    deadline = admittedEpochMs + spec.workAllowanceMs;
    await writeJson(path.join(root, "admitted.json"), {
        receiptId: spec.receiptId,
        workerPid: process.pid,
        admittedEpochMs,
        workDeadlineEpochMs: deadline,
        ...(spec.expectedCheckpoint
            ? {
                  checkpointExpectationHash: checkpointExpectationHash(
                      spec.expectedCheckpoint,
                  ),
                  compiledHashesHash,
              }
            : {}),
    });
    if (!receipt.corpusId) {
        receipt.corpusId = (
            await service.createCorpus(
                "Original-indexed canonical commit crash",
            )
        ).corpusId;
        await persist();
    }
    const corpusId = receipt.corpusId;
    const settle = async () => {
        for (;;) {
            const snapshot = await service.listViews(corpusId);
            const jobs = await service.listViewBuilds(corpusId);
            if (
                !(
                    snapshot.wikiFamily?.enabled && snapshot.wikiFamily.pending
                ) &&
                !jobs.some((job) => job.state === "running")
            )
                return snapshot;
            assert.ok(
                Date.now() < deadline,
                "Canonical crash work bound exhausted, not partial success",
            );
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    };
    const family = async (operation) =>
        service.maintainViews({
            corpusId,
            family: "wiki",
            operation,
            expectedHead: (await service.listViews(corpusId)).head,
        });
    if (mode === "timing") {
        receipt.phase = "minimal-scoped-worksheet-timing";
        for (const kind of ["wiki", "projects", "topics"])
            await service.maintainViews({
                corpusId,
                family: kind,
                operation: "pause",
                expectedHead: (await service.listViews(corpusId)).head,
            });
        const text = await readFile(
            path.resolve(
                product,
                "..",
                "..",
                "memoryDemo",
                "memory-import-second-brain-maintenance",
                "content-only",
                "initial",
                "document-020.md",
            ),
            "utf8",
        );
        const admitted = await service.ingestDocument({
            corpusId,
            source: { sourceType: "markdown", title: "document-020.md", text },
        });
        const sourceJob = await waitForMemoryJob(service, admitted.jobId, {
            pollIntervalMs: 20,
            signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
        assert.equal(sourceJob.state, "complete");
        const currentSource = await service.getSource(
            corpusId,
            admitted.sourceId,
        );
        const viewId = randomUUID();
        const definition = {
            viewId,
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [
                    {
                        sourceId: admitted.sourceId,
                        revisionId: currentSource.activeRevisionId,
                    },
                ],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "Governing tail exception",
                aliases: [],
                excludedSourceIds: [],
            },
        };
        const startedEpochMs = Date.now();
        controls.onEvent("api.buildViews", "ENTER", {
            viewId,
            sourceIds: [admitted.sourceId],
        });
        let job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [{ definition, expectedVersion: 0 }],
        });
        receipt.jobId = job.jobId;
        while (job.state === "running") {
            receipt.lastJob = {
                jobId: job.jobId,
                state: job.state,
                results: job.results.map((result) => ({
                    viewId: result.viewId,
                    state: result.state,
                    reason: result.reason,
                })),
            };
            await persist();
            assert.ok(
                Date.now() < deadline,
                "External diagnostic bound, never product capacity",
            );
            await new Promise((resolve) => setTimeout(resolve, 50));
            job = await service.getViewBuild({ corpusId, jobId: job.jobId });
            assert.ok(job);
        }
        await writeJson(path.join(root, "last-job.json"), job);
        const elapsedMs = Date.now() - startedEpochMs;
        controls.onEvent("api.buildViews", "EXIT", {
            viewId,
            jobId: job.jobId,
            elapsedMs,
            state: job.state,
        });
        const timeout = job.results.some((result) =>
            result.reason?.includes(
                "Evidence-first synthesis exceeded 120 second limit",
            ),
        );
        const actual = await service.getView({ corpusId, viewId });
        receipt.diagnostic = {
            elapsedMs,
            jobId: job.jobId,
            state: job.state,
            productTargetLimitMs: 120000,
            sourceId: admitted.sourceId,
            sourceRevisionId: currentSource.activeRevisionId,
            results: job.results.map((result) => ({
                viewId: result.viewId,
                state: result.state,
                reason: result.reason,
            })),
            actualFingerprint: actual?.generation?.input?.selectionFingerprint,
            actualBodyContainsGoverningTail:
                actual?.content.sections.some((section) =>
                    section.body.includes("Governing tail exception:"),
                ) ?? false,
            corpusSources: (await service.listSources(corpusId)).length,
            representativeSelection: false,
            configuredHolds: false,
            limitation:
                "One scoped worksheet/current default index, no23-source family workload or fullstage replay; no claim whole-target root cause resolved",
        };
        receipt.outcome = timeout
            ? "DIAGNOSTIC_TARGET_120S_REPRODUCED"
            : "DIAGNOSTIC_TARGET_120S_NOT_REPRODUCED_ROOT_PENDING";
    } else {
        if (mode === "crash") {
            await family("pause");
            for (const otherFamily of ["projects", "topics"])
                await service.maintainViews({
                    corpusId,
                    family: otherFamily,
                    operation: "pause",
                    expectedHead: (await service.listViews(corpusId)).head,
                });
            const ingest = async (stage, previous) => {
                const text = await readFile(
                    path.resolve(
                        product,
                        "..",
                        "..",
                        "memoryDemo",
                        "memory-import-second-brain-maintenance",
                        "content-only",
                        stage,
                        "document-021.md",
                    ),
                    "utf8",
                );
                const source = {
                    sourceType: "markdown",
                    title: "document-021.md",
                    text,
                };
                const admitted = previous
                    ? await service.replaceSource({
                          corpusId,
                          sourceId: previous.sourceId,
                          expectedActiveRevisionId: (
                              await service.getSource(
                                  corpusId,
                                  previous.sourceId,
                              )
                          ).activeRevisionId,
                          source,
                      })
                    : await service.ingestDocument({ corpusId, source });
                const job = await waitForMemoryJob(service, admitted.jobId, {
                    pollIntervalMs: 20,
                    signal: AbortSignal.timeout(
                        Math.max(1, deadline - Date.now()),
                    ),
                });
                assert.equal(job.state, "complete");
                return admitted;
            };
            const initial = await ingest("initial");
            await family("resume");
            await settle();
            await family("pause");
            await ingest("t1", initial);
            receipt.phase = "t1";
            await persist();
            await family("resume");
            await settle();
            throw new Error("No actual accepted consolidation/crash occurred");
        }
        const snapshot = await settle();
        const crash = receipt.actions.crash;
        const ready = await verifyConsolidation(service, corpusId);
        assert.equal(ready.jobId, crash.jobId);
        assert.equal(ready.currentRevisionId, crash.revisionId);
        assert.equal(
            receipt.counters.consolidationActual,
            crash.counters.consolidationActual,
        );
        assert.equal(
            receipt.counters.callsByView[crash.viewId],
            crash.targetSynthesisCalls,
        );
        const history = await service.getViewHistory({
            corpusId,
            viewId: crash.viewId,
        });
        assert.equal(
            history.filter(
                (entry) => entry.version.revisionId === crash.revisionId,
            ).length,
            1,
        );
        if (mode === "repeat") {
            assert.equal(snapshot.head, receipt.recovery.head);
            assert.deepEqual(
                snapshot.views.map((view) => view.revisionId).sort(),
                receipt.recovery.revisions,
            );
            assert.deepEqual(receipt.counters, receipt.recovery.counters);
            receipt.repeat = {
                sameHead: true,
                sameRevisions: true,
                extraModelCalls: 0,
            };
            receipt.publicReadWrite = await publicRoundTrip(
                service,
                corpusId,
                ready,
                load,
                nativeFetch,
            );
            service = new FileMemoryService(store, options);
            await service.initialize();
            await settle();
            const { createMemoryServiceRpcFacade } = await load(
                "packages\\memory\\service\\dist\\rpcFacade.js",
            );
            const client = createMemoryServiceRpcFacade(service);
            const sources = await client.listSources(corpusId);
            assert.equal(sources.length, 1);
            const sourceId = sources[0].sourceId;
            const preview = await client.previewForgetSource(
                corpusId,
                sourceId,
            );
            const forgotten = await client.forgetSource({
                corpusId,
                sourceId,
                confirmationToken: preview.confirmationToken,
            });
            await settle();
            await assert.rejects(
                client.getSourceContent({ corpusId, sourceId }),
            );
            for (const viewId of [ready.survivorViewId, ready.retiringViewId]) {
                assert.equal(
                    await client.getView({ corpusId, viewId }),
                    undefined,
                );
                assert.deepEqual(
                    await client.getViewHistory({ corpusId, viewId }),
                    [],
                );
            }
            assert.equal(
                await client.getViewBuild({ corpusId, jobId: ready.jobId }),
                undefined,
            );
            const remaining = await client.listViewBuilds(corpusId);
            assert.ok(!JSON.stringify(remaining).includes(sourceId));
            assert.equal((await client.listSources(corpusId)).length, 0);
            receipt.privacy = {
                sourceId,
                deletedRevisionCount: forgotten.deletedRevisionCount,
                canonicalAndAliasDenied: true,
                historyAndJobSuppressed: true,
                actualSourceCounts: [1, 0],
                scope: "Actual public RPC authorized source forget after canonical/no-op/public-edit proof; distinct mechanism corpus only",
            };
            receipt.outcome = "PASS_OFFLINE_CANONICAL_PROCESS_CRASH_RECOVERY";
        } else {
            receipt.recovery = {
                ...ready,
                head: snapshot.head,
                revisions: snapshot.views.map((view) => view.revisionId).sort(),
                counters: structuredClone(receipt.counters),
                committedExtraSynthesis: 0,
                committedExtraJudgments: 0,
                exactAcceptedRevisionCount: 1,
                otherPendingWorkPurposeCalls:
                    receipt.counters.consolidationPurpose -
                    crash.counters.consolidationPurpose,
            };
            receipt.outcome = "RECOVERED_SECOND_RESTART_PENDING";
        }
    }
    await persist();
} catch (error) {
    receipt.outcome = "FAILED";
    receipt.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
    await persist();
    throw error;
} finally {
    restore?.();
    if (service) {
        receipt.close = await closeOwnedService(service);
        if (!receipt.close.completed) {
            receipt.outcome = "CLEANUP_FAILED";
            process.exitCode = 1;
        }
    }
    restoreTrace?.();
    globalThis.fetch = nativeFetch;
    if (priorEmbedding === undefined)
        delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    else process.env.TYPEAGENT_EMBEDDING_PROVIDER = priorEmbedding;
    await verifyFrozenCheckpoint();
    await persist();
}
