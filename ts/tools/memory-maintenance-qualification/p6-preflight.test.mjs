// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createOfflineOptions } from "./offline-models.mjs";
import {
    scopeFromOriginals,
    checkActualConsolidation,
    installP6Options,
    reviewTerms,
    verifyConsolidation,
} from "./p6-preflight.mjs";
import { publicRoundTrip } from "./public-roundtrip.mjs";
import { supervise } from "./watchdog.mjs";
import {
    assertCheckpoint,
    recordOwnedFixtureProtection,
    resolveOwnedFixtureConflict,
    snapshotCompiledCheckpoint,
} from "./harness.mjs";

const product = path.resolve(import.meta.dirname, "..", "..");
const fixtureRoot = path.resolve(
    product,
    "packages",
    "memory",
    "service",
    "test",
    "fixtures",
    "memoryDemo",
    "memory-import-second-brain-maintenance",
    "content-only",
);
const load = (relative) =>
    import(pathToFileURL(path.join(product, relative)).href);
const { FileMemoryService } = await load(
    "packages\\memory\\service\\dist\\fileMemoryService.js",
);
const { TypedViewStore } = await load(
    "packages\\memory\\service\\dist\\viewStore.js",
);
const { waitForMemoryJob, createMemoryServiceRpcFacade } = await load(
    "packages\\memory\\service\\dist\\rpcFacade.js",
);
const { ViewBuildStaleError } = await load(
    "packages\\memory\\service\\dist\\viewBuilds.js",
);
const { derivedDefinitionInput, authoredRelationships } = await load(
    "packages\\memory\\service\\dist\\viewRelationships.js",
);
const { editorialProtection } = await load(
    "packages\\memory\\service\\dist\\viewEditorial.js",
);
const { viewHash } = await load(
    "packages\\memory\\service\\dist\\viewMerge.js",
);
const protocol = await load("packages\\memory\\client\\dist\\viewProtocol.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const original = (stage, file) =>
    readFile(path.join(fixtureRoot, stage, file), "utf8");
const prose = (view) =>
    view.content.sections.map((section) => section.body).join("\n");
const selectedReviews = (snapshot) =>
    snapshot.views.filter((view) =>
        reviewTerms.includes(view.definition.wiki?.query.toLowerCase()),
    );

test(
    "diagnostic 120s: one bounded default scoped worksheet timing worker, not qualification",
    { timeout: 240000 },
    async () => {
        const root = await mkdtemp(
            path.join(
                process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
                "memory-target-timing-",
            ),
        );
        const receiptId = randomUUID();
        await writeFile(
            path.join(root, "ownership.json"),
            JSON.stringify({ receiptId, runDirectory: root }),
        );
        const termination = await supervise(
            {
                mode: "offline",
                p6: true,
                productRoot: product,
                fixtureRoot: path.resolve(fixtureRoot, "..", ".."),
                runDirectory: root,
                receiptId,
                startupAllowanceMs: 30000,
                workAllowanceMs: 180000,
                probeMode: "timing",
                resume: false,
            },
            path.join(import.meta.dirname, "canonical-crash-worker.mjs"),
        );
        assert.equal(
            termination.workerExited,
            true,
            `Preserved diagnostic ${root}`,
        );
        process.stdout.write(
            `Owned bounded target diagnostic receipt: ${path.join(root, "receipt.json")}\n`,
        );
        assert.equal(
            termination.forced,
            false,
            "External bound exhausted is INCOMPLETE, not a product diagnosis",
        );
        assert.equal(termination.exit.code, 0);
        const receipt = JSON.parse(
            await readFile(path.join(root, "receipt.json"), "utf8"),
        );
        assert.ok(receipt.outcome.startsWith("DIAGNOSTIC_TARGET_120S_"));
        assert.equal(receipt.counters.network, 0);
    },
);

test(
    "product C11: actual canonical-commit process exit86 recovers aliases/index/ack and second restart without judgment or revisions",
    { timeout: 480000 },
    async () => {
        const root = await mkdtemp(
            path.join(
                process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
                "memory-p6-canonical-crash-",
            ),
        );
        const receiptId = randomUUID();
        await writeFile(
            path.join(root, "ownership.json"),
            JSON.stringify({ receiptId, runDirectory: root }),
        );
        const terminations = [];
        const expectedCheckpoint = {
            name: "Explicit current compiled C11 test checkpoint",
            hashes: await snapshotCompiledCheckpoint(product),
        };
        for (const [probeMode, expectedExit] of [
            ["crash", 86],
            ["recover", 0],
            ["repeat", 0],
        ]) {
            const termination = await supervise(
                {
                    mode: "offline",
                    p6: true,
                    productRoot: product,
                    fixtureRoot: path.resolve(fixtureRoot, "..", ".."),
                    runDirectory: root,
                    receiptId,
                    startupAllowanceMs: 30000,
                    workAllowanceMs: 120000,
                    resume: probeMode !== "crash",
                    probeMode,
                    expectedCheckpoint,
                    nativeProfile: false,
                },
                path.join(import.meta.dirname, "canonical-crash-worker.mjs"),
            );
            terminations.push(termination);
            await writeFile(
                path.join(root, "worker-exits.json"),
                JSON.stringify(terminations, null, 2),
            );
            assert.equal(termination.workerExited, true);
            assert.equal(termination.forced, false);
            assert.equal(
                termination.exit.code,
                expectedExit,
                `Retained actual child logs in ${root}`,
            );
        }
        const receipt = JSON.parse(
            await readFile(path.join(root, "receipt.json"), "utf8"),
        );
        assert.equal(
            receipt.outcome,
            "PASS_OFFLINE_CANONICAL_PROCESS_CRASH_RECOVERY",
        );
        assert.equal(receipt.repeat.extraModelCalls, 0);
        assert.equal(receipt.privacy.canonicalAndAliasDenied, true);
        assert.equal(receipt.privacy.historyAndJobSuppressed, true);
        process.stdout.write(
            `Owned actual crash/recovery receipt: ${path.join(root, "receipt.json")}\n`,
        );
    },
);

async function runProductCase(name, run, workAllowanceMs = 240000) {
    const root = await mkdtemp(
        path.join(
            process.env.QUALIFICATION_ARTIFACTS ?? os.tmpdir(),
            "memory-p6-mechanism-",
        ),
    );
    const receipt = {
        name,
        root,
        pid: process.pid,
        startedEpochMs: Date.now(),
        status: "RUNNING",
        scope: "Actual isolated current compiled product APIs with deterministic injected models; semantic C1-C11 pending",
    };
    await writeFile(
        path.join(root, "ownership.json"),
        JSON.stringify({ root, pid: process.pid, name }),
    );
    const counters = {
        extraction: 0,
        article: 0,
        topic: 0,
        synopsis: 0,
        assessment: 0,
        editorial: 0,
        network: 0,
        unexpectedCompletion: 0,
        unexpectedValidation: 0,
    };
    const controls = { p6: true };
    const priorEmbedding = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    const fetch = globalThis.fetch;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    globalThis.fetch = async () => {
        counters.network++;
        throw new Error("No network in offline product mechanism test");
    };
    let service;
    let release;
    const expectedCheckpoint = process.env.QUALIFICATION_CHECKPOINT
        ? JSON.parse(
              await readFile(process.env.QUALIFICATION_CHECKPOINT, "utf8"),
          )
        : undefined;
    if (expectedCheckpoint) {
        const current = await snapshotCompiledCheckpoint(product);
        assertCheckpoint(current, expectedCheckpoint);
        assert.deepEqual(current, expectedCheckpoint.hashes);
        receipt.checkpoint = {
            name: expectedCheckpoint.name,
            files: Object.keys(current).length,
        };
    }
    try {
        const options = await createOfflineOptions(load, counters, controls);
        await installP6Options(options, load, counters, controls);
        options.sourceSynopses = false;
        delete options.sourceSynopsisModel;
        const store = path.join(root, "store");
        const open = () => new FileMemoryService(store, options);
        service = open();
        await service.initialize();
        const { corpusId } = await service.createCorpus(name);
        receipt.corpusId = corpusId;
        const admittedEpochMs = Date.now();
        const deadline = admittedEpochMs + workAllowanceMs;
        receipt.admission = {
            admittedEpochMs,
            workAllowanceMs,
            deadlineEpochMs: deadline,
        };
        const timed = async (predicate) => {
            while (!(await predicate())) {
                assert.ok(
                    Date.now() < deadline,
                    "Bounded product test incomplete, never partial success",
                );
                await pause(20);
            }
        };
        const guard = async (action) => {
            for (let attempt = 0; attempt < 20; attempt++) {
                try {
                    return await action();
                } catch (error) {
                    if (
                        !(error instanceof ViewBuildStaleError) ||
                        attempt === 19
                    )
                        throw error;
                    await pause(20);
                }
            }
        };
        const family = (operation) =>
            guard(async () =>
                service.maintainViews({
                    corpusId,
                    family: "wiki",
                    operation,
                    expectedHead: (await service.listViews(corpusId)).head,
                }),
            );
        for (const kind of ["wiki", "projects", "topics"])
            await guard(async () =>
                service.maintainViews({
                    corpusId,
                    family: kind,
                    operation: "pause",
                    expectedHead: (await service.listViews(corpusId)).head,
                }),
            );
        const settle = async (allowConflict = false) => {
            await timed(async () => {
                const snapshot = await service.listViews(corpusId);
                const jobs = await service.listViewBuilds(corpusId);
                const paused = snapshot.wikiFamily?.enabled === false;
                if (paused && snapshot.wikiFamily.pending)
                    receipt.parked = {
                        wikiFamily: snapshot.wikiFamily,
                        status: "PARKED_NOT_READY",
                        reason: "Explicitly paused dirty family is not admitted work",
                    };
                return (
                    !jobs.some((job) => job.state === "running") &&
                    (!snapshot.wikiFamily?.pending ||
                        paused ||
                        (allowConflict &&
                            jobs.some((job) =>
                                job.results.some(
                                    (result) => result.state === "conflicted",
                                ),
                            )))
                );
            });
            return service.listViews(corpusId);
        };
        const ingest = async (stage, file, previous) => {
            const source = {
                sourceType: "markdown",
                title: file,
                text: await original(stage, file),
            };
            assert.ok(!source.text.includes("MAINTENANCE_EVALUATOR_ONLY"));
            const admitted = previous
                ? await service.replaceSource({
                      corpusId,
                      sourceId: previous.sourceId,
                      expectedActiveRevisionId: (
                          await service.getSource(corpusId, previous.sourceId)
                      ).activeRevisionId,
                      source,
                  })
                : await service.ingestDocument({ corpusId, source });
            const job = await waitForMemoryJob(service, admitted.jobId, {
                pollIntervalMs: 20,
                signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
            });
            assert.equal(job.state, "complete", JSON.stringify(job));
            return admitted;
        };
        const save = (view, content, extra = {}) =>
            guard(async () =>
                service.saveViewDraft({
                    corpusId,
                    viewId: view.viewId,
                    expectedVersion: view.version,
                    expectedHead: (await service.listViews(corpusId)).head,
                    definition: derivedDefinitionInput(view),
                    relationships: authoredRelationships(view),
                    content,
                    ...extra,
                }),
            );
        const forget = async (sourceId) => {
            const preview = await service.previewForgetSource(
                corpusId,
                sourceId,
            );
            await assert.rejects(
                service.forgetSource({
                    corpusId,
                    sourceId,
                    confirmationToken: "invalid-offline-confirmation",
                }),
            );
            return service.forgetSource({
                corpusId,
                sourceId,
                confirmationToken: preview.confirmationToken,
            });
        };
        const restart = async () => {
            await service.close();
            service = open();
            await service.initialize();
            return settle();
        };
        await run({
            service: () => service,
            store: () => new TypedViewStore(store),
            corpusId,
            controls,
            adapter: options.viewSynthesisAdapter,
            counters,
            nativeFetch: fetch,
            family,
            settle,
            timed,
            guard,
            ingest,
            save,
            forget,
            restart,
            receipt,
            hold: () => {
                controls.consolidationHold = new Promise((resolve) => {
                    release = resolve;
                });
            },
            release: () => {
                release?.();
                delete controls.consolidationHold;
            },
        });
        assert.equal(counters.network, 0);
        assert.equal(counters.unexpectedCompletion, 0);
        assert.equal(counters.unexpectedValidation, 0);
        receipt.status = "PASS_OFFLINE_MECHANISM";
    } catch (error) {
        receipt.status = "FAILED";
        receipt.error = {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
        throw error;
    } finally {
        release?.();
        if (service) await service.close();
        if (expectedCheckpoint) {
            const current = await snapshotCompiledCheckpoint(product);
            assertCheckpoint(current, expectedCheckpoint);
            assert.deepEqual(current, expectedCheckpoint.hashes);
            receipt.checkpoint.afterCloseEqual = true;
        }
        globalThis.fetch = fetch;
        if (priorEmbedding === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = priorEmbedding;
        receipt.counters = counters;
        receipt.finishedEpochMs = Date.now();
        await writeFile(
            path.join(root, "receipt.json"),
            JSON.stringify(receipt, null, 2),
        );
        process.stdout.write(
            `Owned preserved product receipt: ${path.join(root, "receipt.json")} ${receipt.status}\n`,
        );
    }
}

test("adapter control: equivalence requires supplied original clarification and actual-output preservation", async () => {
    const views = reviewTerms.map((query) => ({
        definition: { wiki: { query } },
    }));
    const input = (excerpt) => ({ inputs: [{ passages: [{ excerpt }] }] });
    assert.equal(
        scopeFromOriginals(
            input(await original("initial", "document-021.md")),
            ...views,
        ).relation,
        "distinct",
    );
    const current = input(await original("t1", "document-021.md"));
    const scope = scopeFromOriginals(current, ...views);
    assert.equal(scope.relation, "samePurpose");
    const output = {
        content: {
            sections: [{ body: current.inputs[0].passages[0].excerpt }],
        },
    };
    assert.equal(checkActualConsolidation(current, output, scope).safe, true);
    assert.equal(
        checkActualConsolidation(
            current,
            { content: { sections: [{ body: "Approved and complete" }] } },
            scope,
        ).safe,
        false,
    );
    assert.equal(
        checkActualConsolidation(current, output, {
            ...scope,
            criticalDistinctions: [
                { fragmentId: "f99", statement: "Invented" },
            ],
        }).safe,
        false,
    );
    assert.equal(
        scopeFromOriginals(current, views[0], {
            definition: { wiki: { query: "application connection pool" } },
        }).relation,
        "distinct",
    );
    for (const excerpt of [
        current.inputs[0].passages[0].excerpt.replace(
            "Payments API",
            "Identity Gateway",
        ),
        current.inputs[0].passages[0].excerpt.replace(
            "reliability capacity review",
            "schema migration review",
        ),
    ])
        assert.equal(
            scopeFromOriginals(input(excerpt), ...views).relation,
            "distinct",
        );
});

test(
    "product C1: each actual article contains all822 governing tail characters and resolved original citation/limits",
    { timeout: 300000 },
    async () => {
        await runProductCase(
            "C1 actual governing tail article",
            async (ctx) => {
                const readSelectorHash = async () =>
                    createHash("sha256")
                        .update(
                            await readFile(
                                path.join(
                                    product,
                                    "packages\\memory\\service\\dist\\indexedFragments.js",
                                ),
                            ),
                        )
                        .digest("hex");
                const selectorHash = await readSelectorHash();
                ctx.receipt.selectorHash = selectorHash;
                assert.notEqual(ctx.controls.representativeSelection, true);
                let captured;
                const generate = ctx.adapter.generate;
                ctx.adapter.generate = function (...args) {
                    captured = args[0];
                    return Reflect.apply(generate, this, args);
                };
                const facade = createMemoryServiceRpcFacade(ctx.service());
                let ref;
                let accepted;
                const viewId = randomUUID();
                ctx.receipt.stages = [];
                const { verifyTailArticle } = await import(
                    "./p6-preflight.mjs"
                );
                for (const stage of ["initial", "t1", "t2"]) {
                    ref = await ctx.ingest(stage, "document-020.md", ref);
                    const definition = {
                        viewId,
                        kind: "wiki",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: ref.sourceId,
                                    revisionId: ref.revisionId,
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
                    const actualCurrent = await ctx
                        .store()
                        .getView({ corpusId: ctx.corpusId, viewId });
                    const job = await ctx.guard(async () =>
                        ctx.service().buildViews({
                            corpusId: ctx.corpusId,
                            expectedHead: (
                                await ctx.service().listViews(ctx.corpusId)
                            ).head,
                            targets: [
                                {
                                    definition,
                                    expectedVersion:
                                        actualCurrent?.version ?? 0,
                                },
                            ],
                        }),
                    );
                    await ctx.timed(
                        async () =>
                            (
                                await ctx.service().getViewBuild({
                                    corpusId: ctx.corpusId,
                                    jobId: job.jobId,
                                })
                            ).state !== "running",
                    );
                    const done = await ctx.service().getViewBuild({
                        corpusId: ctx.corpusId,
                        jobId: job.jobId,
                    });
                    assert.ok(
                        done.results.every((result) =>
                            ["draft", "merged"].includes(result.state),
                        ),
                        JSON.stringify(done.results),
                    );
                    accepted = await ctx
                        .service()
                        .getView({ corpusId: ctx.corpusId, viewId });
                    const tail = await verifyTailArticle(
                        ctx.service(),
                        ctx.corpusId,
                        viewId,
                        path.join(fixtureRoot, stage, "document-020.md"),
                    );
                    const raw = await original(stage, "document-020.md");
                    const expected = raw.slice(
                        raw.indexOf("Governing tail exception:"),
                        raw.indexOf("Governing tail exception:") + 822,
                    );
                    assert.ok(
                        captured.inputs
                            .flatMap((source) => source.passages ?? [])
                            .some((passage) =>
                                passage.excerpt.includes(expected),
                            ),
                        "Full original tail must reach actual generation input",
                    );
                    const typed = protocol.viewVersionSchema.parse(
                        await facade.getView({
                            corpusId: ctx.corpusId,
                            viewId,
                        }),
                    );
                    assert.deepEqual(typed.content, accepted.content);
                    assert.ok(
                        prose(typed).includes(expected),
                        "Typed public ARTICLE retains full tail",
                    );
                    assert.equal(tail.sourceRevisionId, ref.revisionId);
                    ctx.receipt.stages.push({
                        stage,
                        jobId: job.jobId,
                        ...tail,
                        capturedTailChars: expected.length,
                        typedRead: "real-RPC-facade/shared-public-schema",
                        selection:
                            "DEFAULT current KnowPro; no representative override",
                    });
                }
                assert.equal(
                    await readSelectorHash(),
                    selectorHash,
                    "Compiled selector changed during the product mechanism test",
                );
                ctx.receipt.representativeSelections =
                    ctx.controls.representativeSelections;
            },
        );
    },
);

test(
    "product C5: original ambiguous navigation stays distinct from Identity/Orders scoped articles and local acceptance",
    { timeout: 300000 },
    async () => {
        await runProductCase("C5 scoped original navigation", async (ctx) => {
            let ref = await ctx.ingest("initial", "document-022.md");
            await ctx.family("resume");
            const initial = await ctx.settle();
            const old = initial.views.find(
                (view) => view.definition.wiki?.query === "overlap review",
            );
            assert.ok(old, "Actual initial old navigation must be exercised");
            await ctx.family("pause");
            ref = await ctx.ingest("t1", "document-022.md", ref);
            assert.notEqual(ctx.controls.representativeSelection, true);
            const literal = await ctx.controls.indexes.at(-1).readFragments({
                sourceIds: [ref.sourceId],
                terms: ["overlap review"],
                maxFragments: 12,
                maxReadChars: 32000,
                maxCharsPerFragment: 2000,
            });
            assert.equal(
                literal.fragments.length,
                0,
                "Old literal posting must remain absent",
            );
            ctx.receipt.defaultLiteralSelection = {
                fragments: literal.fragments.length,
                override: false,
            };
            await ctx.family("resume");
            const t1 = await ctx.settle();
            const scopes = [
                "Identity token rotation",
                "Orders schema migration",
            ].map((query) =>
                t1.views.find(
                    (view) =>
                        view.definition.wiki?.query.toLowerCase() ===
                        query.toLowerCase(),
                ),
            );
            assert.ok(
                scopes.every(Boolean),
                "Both actual scoped variants required, absent extraction is not pass",
            );
            assert.notEqual(scopes[0].viewId, scopes[1].viewId);
            ctx.receipt.partialObservations = {
                oldViewId: old.viewId,
                scopedViewIds: scopes.map((view) => view.viewId),
                sourceId: ref.sourceId,
                status: "OBSERVED_NOT_FINAL_PASS",
            };
            for (const view of [old, ...scopes]) {
                const navigated = await ctx.service().getView({
                    corpusId: ctx.corpusId,
                    viewId: view.viewId,
                });
                assert.ok(
                    navigated,
                    "Old navigation unavailable after scope update; new scoped variants alone cannot pass C5",
                );
                assert.equal(navigated.redirect, undefined);
            }
            assert.ok(prose(scopes[0]).includes("production"));
            assert.ok(prose(scopes[1]).includes("still open at T1"));
            assert.equal(ctx.controls.representativeSelections, undefined);
            const refreshed = protocol.viewVersionSchema.parse(
                await ctx.service().getView({
                    corpusId: ctx.corpusId,
                    viewId: old.viewId,
                }),
            );
            assert.notEqual(refreshed.revisionId, old.revisionId);
            const actualSource = await ctx
                .service()
                .getSource(ctx.corpusId, ref.sourceId);
            const currentCitation = refreshed.content.citations.find(
                (citation) =>
                    citation.sourceId === ref.sourceId &&
                    citation.revisionId === actualSource.activeRevisionId,
            );
            assert.ok(currentCitation);
            const resolved = await ctx.service().getSourceContent({
                corpusId: ctx.corpusId,
                sourceId: currentCitation.sourceId,
                revisionId: currentCitation.revisionId,
                indexedLocator: currentCitation.locator,
            });
            assert.equal(resolved.content, currentCitation.excerpt);
            assert.equal(resolved.content.length, 844);
            assert.ok(prose(refreshed).includes(resolved.content));
            ctx.receipt.defaultRefresh = {
                oldViewId: old.viewId,
                priorRevisionId: old.revisionId,
                currentRevisionId: refreshed.revisionId,
                sourceId: ref.sourceId,
                sourceRevisionId: actualSource.activeRevisionId,
                locator: currentCitation.locator,
                chars: resolved.content.length,
                representativeOverride: false,
            };
            await ctx.family("pause");
            await ctx.ingest("t2", "document-022.md", ref);
            await ctx.family("resume");
            await ctx.settle();
            const current = await ctx
                .service()
                .getView({ corpusId: ctx.corpusId, viewId: old.viewId });
            assert.equal(current.redirect, undefined);
            assert.ok(prose(current).includes("still planned, not executed"));
            assert.ok(prose(current).includes("cutover date remains unknown"));
            ctx.receipt.evidence = {
                oldViewId: old.viewId,
                scopedViewIds: scopes.map((view) => view.viewId),
                sourceId: ref.sourceId,
                currentRevisionId: current.revisionId,
                redirects: 0,
                defaultCurrentOriginalFollowing: true,
                representativeOverride: false,
                limitation:
                    "Actual default KnowPro source-following mechanism; real-model semantic review remains pending",
            };
        });
    },
);

test(
    "product C7: historical human edits forbid retirement after guarded conflict resolution and explicit title unlock",
    { timeout: 300000 },
    async () => {
        await runProductCase(
            "C7 historical human retirement denial",
            async (ctx) => {
                const ref = await ctx.ingest("initial", "document-021.md");
                await ctx.family("resume");
                const initial = await ctx.settle();
                const target = selectedReviews(initial)[0];
                assert.equal(selectedReviews(initial).length, 2);
                await ctx.family("pause");
                const content = structuredClone(target.content);
                content.title = "My deliberate review title";
                content.sections[0].details.note = "Human annotation retained";
                const authored = await ctx.save(target, content);
                const protection = recordOwnedFixtureProtection(
                    authored.version,
                    content.sections[0].id,
                    editorialProtection,
                );
                await ctx.ingest("t1", "document-021.md", ref);
                await ctx.family("resume");
                const t1 = await ctx.settle();
                const protectedView = t1.views.find(
                    (view) => view.viewId === target.viewId,
                );
                assert.equal(protectedView.content.title, content.title);
                assert.equal(
                    protectedView.content.sections[0].details.note,
                    content.sections[0].details.note,
                );
                assert.equal(selectedReviews(t1).length, 2);
                assert.equal(protectedView.actor, "memory-view-generator");
                assert.ok(
                    protectedView.edits.every(
                        (edit) => edit.actor === protection.actor,
                    ),
                );
                assert.equal(ctx.counters.consolidationActual ?? 0, 0);
                await ctx.family("pause");
                ctx.controls.overlapQuery = target.definition.wiki.query;
                const definition = derivedDefinitionInput(protectedView);
                definition.wiki.aliases.push("Bounded conflicting proposal");
                const job = await ctx.service().buildViews({
                    corpusId: ctx.corpusId,
                    expectedHead: (await ctx.service().listViews(ctx.corpusId))
                        .head,
                    targets: [
                        {
                            definition,
                            expectedVersion: protectedView.version,
                        },
                    ],
                });
                await ctx.timed(
                    async () =>
                        (
                            await ctx.service().getViewBuild({
                                corpusId: ctx.corpusId,
                                jobId: job.jobId,
                            })
                        ).state !== "running",
                );
                delete ctx.controls.overlapQuery;
                const done = await ctx
                    .service()
                    .getViewBuild({ corpusId: ctx.corpusId, jobId: job.jobId });
                const result = done.results.find((entry) => entry.conflictId);
                assert.ok(result, "Real conflict response required");
                const conflict = await ctx.service().getViewConflict({
                    corpusId: ctx.corpusId,
                    conflictId: result.conflictId,
                });
                const resolution = {
                    corpusId: ctx.corpusId,
                    conflictId: conflict.conflictId,
                    expectedHead: (await ctx.service().listViews(ctx.corpusId))
                        .head,
                    expectedVersion: conflict.human.version,
                    expectedRevisionId: conflict.expectedRevisionId,
                    inputFingerprint: conflict.input.fingerprint,
                    choice: "human",
                };
                let facade = createMemoryServiceRpcFacade(ctx.service());
                await assert.rejects(
                    facade.resolveViewConflict({
                        ...resolution,
                        inputFingerprint: "a".repeat(64),
                    }),
                );
                const record = {
                    purpose: "owned-T1-title-overlap",
                    corpusId: ctx.corpusId,
                    viewId: protectedView.viewId,
                    jobId: done.jobId,
                    jobActor: done.actor,
                    inputActor: result.snapshot.actor,
                    generatorActor: "memory-view-generator",
                    conflictId: conflict.conflictId,
                    inputFingerprint: result.snapshot.fingerprint,
                    expectedVersion: conflict.human.version,
                    expectedRevisionId: conflict.expectedRevisionId,
                };
                const proof = await resolveOwnedFixtureConflict(
                    facade,
                    ctx.corpusId,
                    record,
                    protection,
                    editorialProtection,
                    viewHash,
                );
                assert.equal(proof.state, "resolved");
                assert.equal(proof.authoredEditsVerified, true);
                assert.deepEqual(proof.humanChoiceEdits, []);
                assert.deepEqual(
                    proof.authoredEditIds,
                    protection.authoredEdits.map((edit) => edit.id),
                );
                const saved = await facade.getView({
                    corpusId: ctx.corpusId,
                    viewId: target.viewId,
                });
                assert.equal(saved.content.title, content.title);
                const resolvedStatus = await facade.listViews(ctx.corpusId);
                assert.ok(
                    !resolvedStatus.wikiFamily?.error?.includes(
                        "user decisions pending",
                    ),
                    "Accepted resolution must clear its historical user decision before unlock/regeneration",
                );
                const unlockedTargets = editorialProtection(saved);
                assert.ok(unlockedTargets.includes("title"));
                const unlocked = await ctx.save(saved, saved.content, {
                    unlockProtection: ["title"],
                });
                assert.deepEqual(
                    editorialProtection(unlocked.version),
                    proof.protectedTargets.filter(
                        (target) => target !== "title",
                    ),
                );
                assert.ok(
                    editorialProtection(unlocked.version).includes(
                        `section:${content.sections[0].id}:note`,
                    ),
                );
                assert.equal(
                    unlocked.version.content.sections[0].details.note,
                    content.sections[0].details.note,
                );
                const historyReader = Object.getPrototypeOf(
                    ctx.service().viewStore.history(ctx.corpusId),
                );
                const originalRead = historyReader.read;
                let postUnlockHydrations = 0;
                historyReader.read = function (...args) {
                    postUnlockHydrations++;
                    return originalRead.apply(this, args);
                };
                let postUnlock;
                try {
                    postUnlock = await facade.listViews(ctx.corpusId);
                } finally {
                    historyReader.read = originalRead;
                }
                assert.equal(postUnlockHydrations, 1);
                assert.equal(
                    postUnlock.wikiFamily.pending,
                    true,
                    "Paused dirty work remains pending after the user decision clears",
                );
                assert.ok(
                    !postUnlock.wikiFamily.error?.includes(
                        "user decisions pending",
                    ),
                    "Accepted metadata-only unlock must clear the historical user decision before regeneration",
                );
                const versionStore = ctx.service().viewStore;
                const originalVersions = versionStore.getViewVersions;
                const committedVersions = await originalVersions.call(
                    versionStore,
                    { corpusId: ctx.corpusId, viewId: target.viewId },
                );
                try {
                    for (const missingRevision of [
                        saved.revisionId,
                        unlocked.version.revisionId,
                    ]) {
                        versionStore.getViewVersions = async () =>
                            committedVersions.filter(
                                (version) =>
                                    version.revisionId !== missingRevision,
                            );
                        const invalid = await facade.listViews(ctx.corpusId);
                        assert.ok(
                            invalid.wikiFamily.error?.includes(
                                "1 user decisions pending",
                            ),
                            "Missing committed lineage must not inherit resolution acceptance",
                        );
                    }
                } finally {
                    versionStore.getViewVersions = originalVersions;
                }
                const postUnlockCalls = structuredClone(ctx.counters);
                const postUnlockRevisions = postUnlock.views
                    .map((view) => view.revisionId)
                    .sort();
                for (let index = 0; index < 2; index++) {
                    await ctx.family("update");
                    const restarted = await ctx.restart();
                    assert.deepEqual(
                        restarted.views.map((view) => view.revisionId).sort(),
                        postUnlockRevisions,
                    );
                    assert.equal(restarted.wikiFamily.pending, true);
                    assert.ok(
                        !restarted.wikiFamily.error?.includes(
                            "user decisions pending",
                        ),
                    );
                    assert.deepEqual(ctx.counters, postUnlockCalls);
                }
                facade = createMemoryServiceRpcFacade(ctx.service());
                await ctx.family("resume");
                await ctx.settle();
                const regenerated = await facade.getView({
                    corpusId: ctx.corpusId,
                    viewId: target.viewId,
                });
                assert.equal(regenerated.actor, "memory-view-generator");
                assert.equal(
                    regenerated.content.summary,
                    saved.content.summary,
                );
                assert.notEqual(
                    regenerated.createdAt,
                    unlocked.version.createdAt,
                );
                assert.ok(
                    Date.parse(regenerated.createdAt) >
                        Date.parse(unlocked.version.createdAt),
                );
                assert.equal(
                    regenerated.content.sections[0].details.note,
                    content.sections[0].details.note,
                );
                const settledBefore = await ctx
                    .service()
                    .listViews(ctx.corpusId);
                const beforeCalls = structuredClone(ctx.counters);
                await ctx.family("update");
                const settledAfter = await ctx.settle();
                assert.deepEqual(
                    settledAfter.views.map((view) => view.revisionId).sort(),
                    settledBefore.views.map((view) => view.revisionId).sort(),
                );
                for (const role of [
                    "article",
                    "topic",
                    "assessment",
                    "editorial",
                    "consolidationPurpose",
                    "consolidationActual",
                ])
                    assert.equal(
                        ctx.counters[role],
                        beforeCalls[role],
                        `${role} repeated on settled no-op`,
                    );
                for (const view of selectedReviews(
                    await ctx.service().listViews(ctx.corpusId),
                ))
                    assert.equal(view.redirect, undefined);
                assert.equal(
                    selectedReviews(await ctx.service().listViews(ctx.corpusId))
                        .length,
                    2,
                );
                assert.equal(ctx.counters.consolidationActual ?? 0, 0);
                const history = await ctx.service().getViewHistory({
                    corpusId: ctx.corpusId,
                    viewId: target.viewId,
                });
                assert.ok(
                    history.some(
                        (entry) =>
                            entry.version.actor !== "memory-view-generator",
                    ),
                );
                ctx.receipt.evidence = {
                    viewId: target.viewId,
                    conflictId: conflict.conflictId,
                    resolutionRevisionId: saved.revisionId,
                    unlockRevisionId: unlocked.version.revisionId,
                    postUnlockHydrations,
                    unlockedTargets: ["title"],
                    remainingProtection: editorialProtection(unlocked.version),
                    guardedPublicResolution: proof,
                    authoredEdits: protection.authoredEdits,
                    generatedVersionBeforeResolution: protectedView.actor,
                    stableSummary: regenerated.content.summary,
                    revisionTimes: [
                        unlocked.version.createdAt,
                        regenerated.createdAt,
                    ],
                    settledNoop: {
                        unchangedRevisions: true,
                        extraModelCalls: 0,
                    },
                    historicalHumanEntries: history.filter(
                        (entry) =>
                            entry.version.actor !== "memory-view-generator",
                    ).length,
                    actualConsolidationCalls: 0,
                };
            },
        );
    },
);

test(
    "product C8/C11: uncited original influence captures automatically; old-ID/history/receipts purge and two exact restarts",
    { timeout: 600000 },
    async () => {
        await runProductCase(
            "C8 uncited consolidation original influence",
            async (ctx) => {
                let worksheet = await ctx.ingest("initial", "document-020.md");
                let review = await ctx.ingest("initial", "document-021.md");
                ctx.controls.omitSourceId = worksheet.sourceId;
                ctx.controls.omitQueries = reviewTerms;
                await ctx.family("resume");
                await ctx.settle();
                await ctx.family("pause");
                worksheet = await ctx.ingest(
                    "t1",
                    "document-020.md",
                    worksheet,
                );
                review = await ctx.ingest("t1", "document-021.md", review);
                await ctx.family("resume");
                await ctx.settle();
                const ready = await verifyConsolidation(
                    ctx.service(),
                    ctx.corpusId,
                );
                const jobs = await ctx.service().listViewBuilds(ctx.corpusId);
                const receipt = jobs
                    .flatMap((job) => job.results)
                    .find(
                        (result) => result.wikiConsolidation?.stage === "ready",
                    ).wikiConsolidation;
                assert.ok(
                    receipt.input.inputs.some((source) =>
                        source.passages?.some(
                            (passage) =>
                                passage.sourceId === worksheet.sourceId,
                        ),
                    ),
                );
                assert.ok(
                    receipt.input.influenceSources.some(
                        (source) => source.sourceId === worksheet.sourceId,
                    ),
                );
                assert.ok(
                    receipt.output.content.citations.every(
                        (citation) => citation.sourceId !== worksheet.sourceId,
                    ),
                );
                ctx.receipt.partialObservations = {
                    ...ready,
                    uncitedSourceId: worksheet.sourceId,
                    citedSourceId: review.sourceId,
                    influenceSources: receipt.input.influenceSources,
                    capture:
                        "Actual automatic service generation/consolidation, no store-seeded inputs",
                    status: "OBSERVED_NOT_FINAL_PASS",
                };
                await ctx.family("pause");
                ctx.receipt.publicRoundTrip = await publicRoundTrip(
                    ctx.service(),
                    ctx.corpusId,
                    ready,
                    load,
                    ctx.nativeFetch,
                );
                const transportCounts = structuredClone(ctx.counters);
                const transportRestart = await ctx.restart();
                assert.equal(
                    transportRestart.head,
                    ctx.receipt.publicRoundTrip.afterEditHead,
                );
                assert.deepEqual(
                    ctx.counters,
                    transportCounts,
                    "Real host shutdown/restart must not regenerate or rejudge",
                );
                const facade = createMemoryServiceRpcFacade(ctx.service());
                const typedOld = protocol.viewVersionSchema.parse(
                    await facade.getView({
                        corpusId: ctx.corpusId,
                        viewId: ready.retiringViewId,
                    }),
                );
                assert.equal(typedOld.redirect.viewId, ready.survivorViewId);
                const typedJobs = (
                    await facade.listViewBuilds(ctx.corpusId)
                ).map((job) => protocol.viewBuildJobSchema.parse(job));
                assert.ok(
                    typedJobs.some((job) =>
                        job.results.some(
                            (result) =>
                                result.wikiConsolidation?.stage === "ready",
                        ),
                    ),
                );
                const head = (await ctx.service().listViews(ctx.corpusId)).head;
                const counts = structuredClone(ctx.counters);
                for (let repeat = 0; repeat < 2; repeat++) {
                    const restarted = await ctx.restart();
                    assert.equal(restarted.head, head);
                    assert.deepEqual(
                        ctx.counters,
                        counts,
                        "Settled restart must make zero extra synthesis/judgment/extraction calls",
                    );
                }
                await ctx.family("pause");
                const forgotten = await ctx.forget(worksheet.sourceId);
                await ctx.settle();
                for (const viewId of [
                    ready.survivorViewId,
                    ready.retiringViewId,
                ]) {
                    assert.equal(
                        await ctx
                            .service()
                            .getView({ corpusId: ctx.corpusId, viewId }),
                        undefined,
                    );
                    assert.deepEqual(
                        await ctx
                            .service()
                            .getViewHistory({ corpusId: ctx.corpusId, viewId }),
                        [],
                    );
                    assert.equal(
                        await ctx.service().getView({
                            corpusId: ctx.corpusId,
                            viewId,
                            revisionId: ready.acceptedRevisionId,
                        }),
                        undefined,
                    );
                }
                assert.ok(
                    !(await ctx.service().listViewBuilds(ctx.corpusId)).some(
                        (job) =>
                            job.results.some(
                                (result) => result.wikiConsolidation,
                            ),
                    ),
                );
                await ctx.restart();
                assert.equal(
                    await ctx.service().getView({
                        corpusId: ctx.corpusId,
                        viewId: ready.retiringViewId,
                    }),
                    undefined,
                );
                ctx.receipt.evidence = {
                    ...ready,
                    uncitedSourceId: worksheet.sourceId,
                    retainedCitedSourceId: review.sourceId,
                    influenceSources: receipt.input.influenceSources,
                    deletedRevisionCount: forgotten.deletedRevisionCount,
                    restartCount: 2,
                    extraCalls: 0,
                    typedTransport:
                        "Actual RPC facade output parsed by current client viewVersion/viewBuildJob schemas",
                    automaticCapture: true,
                };
            },
            480000,
        );
    },
);

test(
    "product C8: held canonical-output checker plus authorized forget denies late acceptance/redirect/history resurrection",
    { timeout: 300000 },
    async () => {
        await runProductCase("C8 held late consolidation", async (ctx) => {
            let ref = await ctx.ingest("initial", "document-021.md");
            await ctx.family("resume");
            const initial = await ctx.settle();
            const oldIds = selectedReviews(initial).map((view) => view.viewId);
            assert.equal(oldIds.length, 2);
            await ctx.family("pause");
            ref = await ctx.ingest("t1", "document-021.md", ref);
            ctx.hold();
            await ctx.family("resume");
            await ctx.timed(async () => ctx.controls.consolidationEntered);
            const captured = structuredClone(ctx.controls.consolidationInputs);
            assert.ok(captured.length);
            await ctx.forget(ref.sourceId);
            ctx.release();
            await ctx.settle();
            for (const viewId of oldIds) {
                assert.equal(
                    await ctx
                        .service()
                        .getView({ corpusId: ctx.corpusId, viewId }),
                    undefined,
                );
                assert.deepEqual(
                    await ctx
                        .service()
                        .getViewHistory({ corpusId: ctx.corpusId, viewId }),
                    [],
                );
            }
            assert.ok(
                !(await ctx.service().listViewBuilds(ctx.corpusId)).some(
                    (job) =>
                        job.results.some((result) => result.wikiConsolidation),
                ),
            );
            await ctx.restart();
            for (const viewId of oldIds)
                assert.equal(
                    await ctx
                        .service()
                        .getView({ corpusId: ctx.corpusId, viewId }),
                    undefined,
                );
            ctx.receipt.evidence = {
                forgottenSourceId: ref.sourceId,
                deniedViewIds: oldIds,
                heldCheckInputs: captured.map((input) => ({
                    fingerprint: input.fingerprint,
                    influenceSources: input.influenceSources,
                })),
                postRestartResurrection: false,
            };
        });
    },
);
