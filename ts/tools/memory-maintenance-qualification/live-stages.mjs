// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
    checkpointExpectationHash,
    guardHeadRequest,
    initialReadiness,
    installSnapshotQualification,
    loadPlan,
    readCanonicalQualification,
    recordOwnedFixtureProtection,
    resolveOwnedFixtureConflict,
    writeJson,
} from "./harness.mjs";
import { measureProgress } from "./evaluate.mjs";
import {
    reconcileLiveSource,
    validateLiveResumeSources,
} from "./live-resume.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const phases = [
    "baseline",
    "meeting-orders",
    "correction",
    "initial",
    "t1",
    "t2",
];
const roles = new AsyncLocalStorage();

export function liveAllowances(spec) {
    return spec.sourceScope === "baseline19"
        ? { workAllowanceMs: 2100000, cleanupReserveMs: 300000 }
        : { workAllowanceMs: 1200000, cleanupReserveMs: 120000 };
}

export function livePhases(spec) {
    assert.ok(
        spec.sourceScope === undefined || spec.sourceScope === "baseline19",
        "Unsupported live source scope",
    );
    return spec.sourceScope === "baseline19" ? phases.slice(0, 3) : [...phases];
}

export async function maintainLiveFamily(service, request, hooks) {
    return guardHeadRequest(
        async () =>
            service.maintainViews({
                ...request,
                expectedHead: (await service.listViews(request.corpusId)).head,
            }),
        hooks,
    );
}

export function observedRoles(model, prefix, receipt) {
    return Object.fromEntries(
        Object.entries(model).map(([name, value]) => [
            name,
            typeof value !== "function" || name === "fits"
                ? value
                : async function (...args) {
                      const started = performance.now();
                      return roles.run(`${prefix}.${name}`, async () => {
                          try {
                              const result = await Reflect.apply(
                                  value,
                                  model,
                                  args,
                              );
                              receipt.roleCalls.push({
                                  role: `${prefix}.${name}`,
                                  milliseconds: performance.now() - started,
                                  outcome: "RETURNED",
                              });
                              return result;
                          } catch (error) {
                              receipt.roleCalls.push({
                                  role: `${prefix}.${name}`,
                                  milliseconds: performance.now() - started,
                                  outcome: "FAILED",
                              });
                              throw error;
                          }
                      });
                  },
        ]),
    );
}

export async function liveDependencyCheckpoint(root) {
    const result = {};
    const visit = async (relative) => {
        for (const entry of await readdir(path.join(root, relative), {
            withFileTypes: true,
        })) {
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else if (entry.name.endsWith(".js"))
                result[next] = hash(await readFile(path.join(root, next)));
        }
    };
    for (const directory of ["aiclient", "config"])
        await visit(path.join("packages", directory, "dist"));
    return result;
}

function providerRequestType(pathname, decisionQuestions) {
    if (decisionQuestions) return "decision";
    if (/\/chat\/completions$/.test(pathname)) return "chat";
    if (/\/embeddings$/.test(pathname)) return "embedding";
    return "other-production-request";
}

export function observeProvider(
    events,
    currentRole = () => "production-default",
) {
    const original = globalThis.fetch;
    globalThis.fetch = async function (...args) {
        const input = args[0];
        const url = new URL(
            typeof input === "string" ? input : (input.url ?? input.href),
        );
        const started = performance.now();
        const role = roles.getStore() ?? currentRole();
        const startedEpochMs = Date.now();
        const request =
            typeof args[1]?.body === "string"
                ? JSON.parse(args[1].body)
                : undefined;
        const response = await Reflect.apply(original, this, args);
        const decisionQuestions = request?.questions;
        const item = {
            startedEpochMs,
            responseEpochMs: Date.now(),
            role,
            type: providerRequestType(url.pathname, decisionQuestions),
            requestedModel: request?.model,
            decisionQuestionCount: decisionQuestions
                ? Object.keys(decisionQuestions).length
                : undefined,
            status: response.status,
            durationMs: performance.now() - started,
            retryAfter: response.headers.get("retry-after"),
            serializedRequestCharacters:
                typeof args[1]?.body === "string"
                    ? args[1].body.length
                    : undefined,
            requestedOutputTokens:
                request?.max_completion_tokens ?? request?.max_tokens,
            requestedTools: request?.tools?.length ?? 0,
        };
        if (response.headers.get("content-type")?.includes("json")) {
            const body = await response.clone().json();
            if (response.ok) {
                item.model = body.model;
                item.usage = body.usage;
            } else {
                item.errorCode = body.error?.code;
                item.errorType = body.error?.type;
                item.errorParameter = body.error?.param;
            }
        }
        events.push(item);
        return response;
    };
    return () => {
        globalThis.fetch = original;
    };
}

export function classifyStoppedRun(error, requests) {
    if (
        /429|throttl/i.test(error?.message ?? "") ||
        requests.at(-1)?.status === 429
    )
        return "PARTIAL_CONFIGURED_PROVIDER_THROTTLE";
    if (/timeout|abort|budget/i.test(error?.name + " " + error?.message))
        return "PARTIAL_BOUNDED_WORK";
    if (requests.at(-1)?.status >= 400)
        return "STOPPED_PROVIDER_REQUEST_FAILURE";
    return "STOPPED_FIRST_UNEXPECTED_PRODUCT_OR_ROLE_FAILURE";
}

export function unexpectedTargets(jobs, resolvedJobId) {
    return jobs
        .filter((job) => job.jobId !== resolvedJobId)
        .flatMap((job) =>
            job.results
                .filter((result) =>
                    [
                        "failed",
                        "blocked",
                        "stale",
                        "cancelled",
                        "interrupted",
                    ].includes(result.state),
                )
                .map((result) => ({
                    jobId: job.jobId,
                    viewId: result.viewId,
                    state: result.state,
                    reason: result.reason,
                })),
        );
}

export async function loadLiveContract(load) {
    const imports = {
        "fileMemoryService.js": ["FileMemoryService"],
        "viewStore.js": ["TypedViewStore"],
        "viewBuilds.js": ["ViewBuildStaleError"],
        "viewHistory.js": ["ViewHistory"],
        "rpcFacade.js": ["waitForMemoryJob"],
        "viewRelationships.js": [
            "derivedDefinitionInput",
            "authoredRelationships",
        ],
        "viewEditorial.js": ["editorialProtection"],
        "viewMerge.js": ["viewHash"],
        "knowProCorpusIndex.js": ["createKnowProCorpusIndex"],
        "viewHostOptions.js": ["getConfiguredMemoryViewOptions"],
        "viewSynthesis.js": ["createConfiguredViewSynthesisAdapter"],
        "sourceSynopsis.js": [
            "configuredSourceSynopsisModel",
            "generateSourceSynopsis",
        ],
        "topicGeneration.js": ["createConfiguredTopicGenerator"],
    };
    const contract = {};
    for (const [file, names] of Object.entries(imports)) {
        const module = await load(`packages\\memory\\service\\dist\\${file}`);
        for (const name of names) {
            assert.equal(
                typeof module[name],
                "function",
                `Missing compiled live export: ${file}/${name}`,
            );
            contract[name] = module[name];
        }
    }
    for (const [file, names] of [
        ["packages\\config\\dist\\index.js", ["loadConfigSync"]],
        [
            "packages\\aiclient\\dist\\index.js",
            ["initRuntimeConfigFromProcessEnv"],
        ],
        [
            "packages\\memory\\conversation\\dist\\memory.js",
            ["createMemorySettings"],
        ],
    ]) {
        const module = await load(file);
        for (const name of names)
            assert.equal(
                typeof module[name],
                "function",
                `Missing compiled live loader export: ${file}/${name}`,
            );
    }
    for (const name of [
        "initialize",
        "close",
        "createCorpus",
        "maintainViews",
        "listViews",
        "listViewBuilds",
        "listSources",
        "getViewConflict",
        "getViewBuild",
        "resolveViewConflict",
        "getView",
        "saveViewDraft",
        "getViewPublication",
        "getSourceContent",
        "ingestDocument",
        "replaceSource",
        "getJob",
        "cancelJob",
        "previewForgetSource",
        "forgetSource",
    ])
        assert.equal(
            typeof contract.FileMemoryService.prototype[name],
            "function",
            `Missing compiled public live API: ${name}`,
        );
    for (const name of ["getTopicState", "getWikiFamily"])
        assert.equal(
            typeof contract.TypedViewStore.prototype[name],
            "function",
            `Missing compiled projection: ${name}`,
        );
    assert.equal(typeof contract.ViewHistory.prototype.read, "function");
    return contract;
}

export async function runLiveStages(
    spec,
    configured,
    receipt,
    load,
    persist,
    safeFailure,
) {
    const {
        FileMemoryService,
        TypedViewStore,
        ViewHistory,
        waitForMemoryJob,
        derivedDefinitionInput,
        authoredRelationships,
        editorialProtection,
        viewHash,
        ViewBuildStaleError,
    } = await loadLiveContract(load);
    const plan = await loadPlan(spec.fixtureRoot);
    const baselineOnly = spec.sourceScope === "baseline19";
    const { cleanupReserveMs } = liveAllowances(spec);
    receipt.sourceScope = baselineOnly ? "baseline19" : "full-timeline";
    const store = path.join(spec.runDirectory, "isolated-store");
    const indexes = new Map();
    const options = { ...configured.options };
    options.viewSynthesisAdapter = observedRoles(
        configured.adapter,
        "view",
        receipt,
    );
    options.sourceSynopsisModel = observedRoles(
        configured.roleCapabilities.synopsis,
        "sourceSynopsis",
        receipt,
    );
    const indexFactory = options.indexFactory;
    options.indexFactory = (id, directory) => {
        const index = indexFactory(id, directory);
        for (const method of ["rebuild", "append", "search"]) {
            const original = index[method];
            index[method] = function (...args) {
                return roles.run(
                    method === "search"
                        ? "queryTranslationAndRetrieval"
                        : "extractionAndEmbedding",
                    () => Reflect.apply(original, index, args),
                );
            };
        }
        indexes.set(directory, index);
        return index;
    };
    const open = () => {
        const value = new FileMemoryService(store, options);
        const generate = value.viewBuilds.topicGenerator;
        assert.equal(
            typeof generate,
            "function",
            "Production topic generator must remain configured",
        );
        value.viewBuilds.topicGenerator = (...args) =>
            roles.run("topicGeneration", () =>
                Reflect.apply(generate, undefined, args),
            );
        return value;
    };
    let service;
    let phase = "startup";
    let deadline;
    const snapshots = installSnapshotQualification(
        ViewHistory,
        FileMemoryService,
        () => phase,
    );
    receipt.store = store;
    if (!spec.resume) {
        receipt.operations = [];
        receipt.mappings = {};
        receipt.stages = {};
        receipt.actions = {};
        receipt.checks = [];
    }
    receipt.pending = baselineOnly
        ? [
              "Independent baseline19 semantic review pending",
              "Temporal extension, protected-edit and forget live cases not exercised",
          ]
        : [
              "Independent live C1-C11 semantic review pending",
              "Offline canonical crash recovery is not live semantic proof",
          ];
    const check = () => {
        assert.equal(
            snapshots.summary.violations.length,
            0,
            "Operation read hydration exceeded exactmax1",
        );
        if (Date.now() >= deadline - cleanupReserveMs)
            throw Object.assign(
                new Error(
                    "Live work budget exhausted; reserving supported close",
                ),
                { name: "TimeoutError" },
            );
    };
    const control = async (family, operation) => {
        return maintainLiveFamily(
            service,
            { corpusId: receipt.corpusId, family, operation },
            {
                checkDeadline: check,
                isStale: (error) => error instanceof ViewBuildStaleError,
                onDiagnostic: (diagnostic) =>
                    (receipt.handledHeadRetries ??= []).push(diagnostic),
                onSuccessfulReturn: (proof) =>
                    (receipt.successfulRequestReturns ??= []).push(proof),
            },
        );
    };
    const inspect = async () => {
        const corpusId = receipt.corpusId;
        const snapshot = await service.listViews(corpusId);
        const jobs = await service.listViewBuilds(corpusId);
        const sources = await service.listSources(corpusId);
        const topic = await new TypedViewStore(store).getTopicState(corpusId);
        return {
            snapshot,
            jobs,
            sources,
            topic,
            readiness: initialReadiness(snapshot, jobs, sources, topic),
        };
    };
    const resolveOwned = async (job, result) => {
        const protection = receipt.actions.protection;
        assert.ok(
            protection && phase === "t1" && result.viewId === protection.viewId,
            "Unexpected human decision: stop without automatic choice",
        );
        const conflict = await service.getViewConflict({
            corpusId: receipt.corpusId,
            conflictId: result.conflictId,
        });
        const record = {
            purpose: "owned-T1-title-overlap",
            corpusId: receipt.corpusId,
            viewId: result.viewId,
            jobId: job.jobId,
            jobActor: job.actor,
            inputActor: conflict.input.actor,
            generatorActor: "memory-view-generator",
            conflictId: result.conflictId,
            inputFingerprint: conflict.input.fingerprint,
            expectedVersion: conflict.human.version,
            expectedRevisionId: conflict.expectedRevisionId,
        };
        receipt.actions.conflictResolution = await resolveOwnedFixtureConflict(
            service,
            receipt.corpusId,
            record,
            protection,
            editorialProtection,
            viewHash,
        );
        await persist();
    };
    const settled = async () => {
        let stable = 0;
        while (stable < 3) {
            check();
            const current = await inspect();
            const failures = unexpectedTargets(
                current.jobs,
                receipt.actions.conflictResolution?.jobId,
            );
            if (failures.length) {
                if (baselineOnly)
                    await writeJson(
                        path.join(
                            spec.runDirectory,
                            "baseline19-terminal-jobs.json",
                        ),
                        current.jobs,
                    );
                receipt.failedTargets = failures.map(
                    ({ reason, ...result }) => ({
                        ...result,
                        reason: reason
                            ? safeFailure(new Error(reason))
                            : undefined,
                    }),
                );
                throw new Error(
                    "First unexpected target failure; no repeated admission",
                );
            }
            for (const job of current.jobs) {
                if (job.state === "running" || job.state === "complete")
                    continue;
                if (job.jobId === receipt.actions.conflictResolution?.jobId)
                    continue;
                const conflict = job.results.find(
                    (result) => result.state === "conflicted",
                );
                if (conflict) await resolveOwned(job, conflict);
                else {
                    receipt.failedTargets = job.results.map(
                        ({ viewId, state, reason, error, errorDetails }) => ({
                            viewId,
                            state,
                            reason: reason
                                ? safeFailure(new Error(reason))
                                : undefined,
                            error: error
                                ? safeFailure(new Error(error))
                                : undefined,
                            errorDetails: errorDetails
                                ? safeFailure(
                                      new Error(JSON.stringify(errorDetails)),
                                  )
                                : undefined,
                        }),
                    );
                    throw new Error("Unexpected terminal maintenance job");
                }
            }
            receipt.progress = {
                phase,
                activeSources: current.sources.length,
                readiness: {
                    ...current.readiness,
                    errors: current.readiness.errors.map((error) =>
                        safeFailure(new Error(error)),
                    ),
                },
                viewCount: current.snapshot.views.length,
                runningJobs: current.jobs
                    .filter((job) => job.state === "running")
                    .map((job) => ({
                        jobId: job.jobId,
                        results: job.results.map(({ viewId, state }) => ({
                            viewId,
                            state,
                        })),
                    })),
            };
            await persist();
            assert.equal(
                current.readiness.errors.length,
                0,
                "Unexpected family readiness error",
            );
            stable = current.readiness.ready ? stable + 1 : 0;
            await delay(250);
        }
    };
    const capture = async (name) => {
        check();
        const { snapshot, jobs, sources, topic } = await inspect();
        const corpusId = receipt.corpusId;
        const publications = [];
        const citations = [];
        const sourceIds = new Set(sources.map((source) => source.sourceId));
        for (const view of snapshot.views) {
            publications.push(
                await service.getViewPublication({
                    corpusId,
                    viewId: view.viewId,
                }),
            );
            for (const citation of view.content.citations) {
                assert.ok(
                    sourceIds.has(citation.sourceId),
                    "Citation refers to an ineligible source",
                );
                assert.equal(
                    sources.find(
                        (source) => source.sourceId === citation.sourceId,
                    ).activeRevisionId,
                    citation.revisionId,
                    "Citation freshness mismatch",
                );
                const original = await service.getSourceContent({
                    corpusId,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    indexedLocator: citation.locator,
                });
                assert.equal(
                    original.content,
                    citation.excerpt,
                    "Citation must equal exact original evidence",
                );
                citations.push({
                    viewId: view.viewId,
                    ...citation,
                    exact: true,
                });
            }
        }
        let occurrences = [];
        const subjects = [];
        for (const [directory, index] of [...indexes.entries()].reverse()) {
            if (
                directory.includes("view-search-index") ||
                directory.includes("event-search-index")
            )
                continue;
            const candidate = await index.getTopicOccurrences(sourceIds);
            if (
                !candidate.length ||
                !candidate.every(
                    (entry) =>
                        sources.find(
                            (source) => source.sourceId === entry.sourceId,
                        )?.activeRevisionId === entry.revisionId,
                )
            )
                continue;
            occurrences = candidate;
            for (let offset = 0; ; ) {
                const page = await index.listSubjects(offset, 48, sourceIds);
                subjects.push(...page.items);
                offset += page.items.length;
                if (!page.items.length || offset >= page.total) break;
            }
            break;
        }
        if (topic.snapshot)
            assert.deepEqual(
                topic.snapshot.occurrences.map((entry) => entry.id).sort(),
                occurrences.map((entry) => entry.id).sort(),
                "Full incidence must match current originals, not display limit",
            );
        const family = await new TypedViewStore(store).getWikiFamily(corpusId);
        const stage = {
            phase: name,
            activeSources: sources.length,
            sourceIds: [...sourceIds],
            revisions: snapshot.views.map((view) => view.revisionId),
            wikiProgress: measureProgress(family, jobs, publications, subjects),
            citations,
            occurrenceCount: occurrences.length,
            topicOccurrenceCount: topic.snapshot?.occurrences.length,
            synopsis: sources.map((source) => ({
                sourceId: source.sourceId,
                activeRevisionId: source.activeRevisionId,
                synopsis: source.revisions.find(
                    (revision) =>
                        revision.revisionId === source.activeRevisionId,
                )?.synopsis,
            })),
        };
        stage.wikiProgress.parked = stage.wikiProgress.parked.map(
            ({ reason, ...item }) => ({
                ...item,
                reason: reason ? safeFailure(new Error(reason)) : undefined,
            }),
        );
        await writeJson(
            path.join(spec.runDirectory, `live-stage-${name}.json`),
            { stage, snapshot, topic, publications, subjects, occurrences },
        );
        receipt.stages[name] = stage;
        await persist();
        return snapshot;
    };
    const save = async (view, content, extra = {}) =>
        service.saveViewDraft({
            corpusId: receipt.corpusId,
            viewId: view.viewId,
            expectedVersion: view.version,
            expectedHead: (await service.listViews(receipt.corpusId)).head,
            definition: derivedDefinitionInput(view),
            relationships: authoredRelationships(view),
            content,
            ...extra,
        });
    const applyPhaseActions = async (snapshot) => {
        if (phase === "initial") {
            const lease = snapshot.views.find(
                (view) =>
                    view.definition.wiki?.query?.toLowerCase() === "lease",
            );
            if (lease?.content.sections?.length) {
                const content = structuredClone(lease.content);
                content.title = "My deliberate isolated lease review";
                content.sections[0].details.note =
                    "Personal synthetic review annotation";
                const accepted = await save(lease, content);
                receipt.actions.protection = recordOwnedFixtureProtection(
                    accepted.version,
                    content.sections[0].id,
                    editorialProtection,
                );
            } else
                receipt.pending.push(
                    "C7 fixture page not naturally discovered; no topic/page injection",
                );
        }
        if (phase === "t1") {
            receipt.actions.naturalCanonical = await readCanonicalQualification(
                service,
                receipt.corpusId,
            );
            if (receipt.actions.protection) {
                const current = await service.getView({
                    corpusId: receipt.corpusId,
                    viewId: receipt.actions.protection.viewId,
                });
                assert.equal(
                    current.content.title,
                    receipt.actions.protection.title,
                );
                assert.equal(
                    current.content.sections.find(
                        (section) =>
                            section.id ===
                            receipt.actions.protection.noteSectionId,
                    )?.details.note,
                    receipt.actions.protection.note,
                );
                const unlocked = (
                    await save(current, current.content, {
                        unlockProtection: ["title"],
                    })
                ).version;
                assert.ok(!editorialProtection(unlocked).includes("title"));
                assert.ok(
                    editorialProtection(unlocked).includes(
                        `section:${receipt.actions.protection.noteSectionId}:note`,
                    ),
                );
                receipt.actions.postUnlockStatus = await service.listViews(
                    receipt.corpusId,
                );
            }
        }
    };
    const applyPhaseSources = async (selectedPlan, applied) => {
        for (const entry of selectedPlan.filter(
            (entry) => entry.phase === phase,
        )) {
            if (selectedPlan.indexOf(entry) < applied) continue;
            check();
            const text = await readFile(entry.file, "utf8");
            assert.equal(hash(text), entry.sha256, "Original fixture changed");
            const source = {
                sourceType: "markdown",
                title: path.basename(entry.file, ".md"),
                canonicalUri: entry.canonicalUri,
                text,
            };
            const admitted = await reconcileLiveSource(
                service,
                receipt.corpusId,
                entry,
                receipt.mappings[entry.sourceKey],
                source,
                spec.resume,
            );
            receipt.inFlight = {
                phase,
                sourceKey: entry.sourceKey,
                fixtureSha256: entry.sha256,
                ...admitted,
            };
            await persist();
            const job = admitted.jobId
                ? await waitForMemoryJob(service, admitted.jobId, {
                      signal: AbortSignal.timeout(
                          Math.max(1, deadline - Date.now() - cleanupReserveMs),
                      ),
                      pollIntervalMs: 100,
                  })
                : admitted;
            if (job.state !== "complete") {
                receipt.ingestionFailure = {
                    state: job.state,
                    error: safeFailure(
                        new Error(job.error ?? "Unknown ingestion failure"),
                    ),
                };
                throw new Error("Actual production ingestion failed");
            }
            receipt.operations.push({
                phase,
                sourceKey: entry.sourceKey,
                fixtureSha256: entry.sha256,
                ...admitted,
                state: job.state,
            });
            receipt.mappings[entry.sourceKey] = {
                sourceId: admitted.sourceId,
                revisionId: admitted.revisionId,
            };
            delete receipt.inFlight;
            delete receipt.ingestionFailure;
            applied++;
            await persist();
        }
        return applied;
    };
    try {
        service = open();
        await service.initialize();
        if (!spec.resume) {
            receipt.corpusId = (
                await service.createCorpus(
                    "Isolated actual Luna maintenance qualification",
                )
            ).corpusId;
            await persist();
        }
        const selectedPlan = plan.filter((entry) =>
            livePhases(spec).includes(entry.phase),
        );
        let applied = spec.resume
            ? await validateLiveResumeSources(
                  service,
                  receipt.corpusId,
                  selectedPlan,
                  receipt,
              )
            : 0;
        const admittedEpochMs = Date.now();
        deadline = baselineOnly
            ? Math.min(
                  admittedEpochMs + spec.workAllowanceMs,
                  spec.spawnedEpochMs + spec.workAllowanceMs,
              )
            : admittedEpochMs + spec.workAllowanceMs;
        await writeJson(path.join(spec.runDirectory, "admitted.json"), {
            receiptId: spec.receiptId,
            workerPid: process.pid,
            admittedEpochMs,
            workDeadlineEpochMs: admittedEpochMs + spec.workAllowanceMs,
            checkpointExpectationHash: checkpointExpectationHash(
                spec.expectedCheckpoint,
            ),
            compiledHashesHash: hash(
                JSON.stringify(spec.expectedCheckpoint.hashes),
            ),
        });
        for (phase of livePhases(spec)) {
            if (receipt.stages[phase]) continue;
            receipt.phase = phase;
            for (const family of ["wiki", "projects", "topics"])
                await control(family, "pause");
            applied = await applyPhaseSources(selectedPlan, applied);
            if (baselineOnly && phase !== "correction") continue;
            if (baselineOnly)
                assert.equal(
                    (await service.listSources(receipt.corpusId)).length,
                    19,
                    "Baseline qualification requires all 19 active sources",
                );
            for (const family of ["wiki", "projects", "topics"])
                await control(family, "resume");
            await settled();
            const snapshot = await capture(phase);
            await applyPhaseActions(snapshot);
            await persist();
        }
        if (!baselineOnly) {
            phase = "t2-forgotten";
            const temporary = receipt.mappings["sb-temporary-handoff"];
            const preview = await service.previewForgetSource(
                receipt.corpusId,
                temporary.sourceId,
            );
            receipt.actions.forget = await service.forgetSource({
                corpusId: receipt.corpusId,
                sourceId: temporary.sourceId,
                confirmationToken: preview.confirmationToken,
            });
            await assert.rejects(
                service.getSourceContent({
                    corpusId: receipt.corpusId,
                    sourceId: temporary.sourceId,
                }),
            );
            await settled();
            await capture(phase);
        }
        receipt.actions.restarts ??= [];
        for (
            let attempt = receipt.actions.restarts.length;
            attempt < 2;
            attempt++
        ) {
            const before = (
                await service.listViews(receipt.corpusId)
            ).views.map(({ viewId, revisionId }) => ({ viewId, revisionId }));
            const requests = receipt.providerRequests.length;
            await service.close();
            service = open();
            await service.initialize();
            for (const family of ["wiki", "projects", "topics"])
                await control(family, "update");
            await settled();
            const after = (await service.listViews(receipt.corpusId)).views.map(
                ({ viewId, revisionId }) => ({ viewId, revisionId }),
            );
            assert.deepEqual(
                after,
                before,
                "Unchanged restart must retain view revisions",
            );
            assert.equal(
                receipt.providerRequests.length,
                requests,
                "Unchanged restart must make zero extra model calls",
            );
            receipt.actions.restarts.push({
                attempt,
                unchangedViewRevisions: true,
                extraProviderCalls: 0,
            });
            await persist();
        }
        receipt.outcome = baselineOnly
            ? "LIVE_BASELINE19_MECHANISMS_COMPLETED_INDEPENDENT_SEMANTIC_REVIEW_PENDING"
            : "LIVE_TIMELINE_MECHANISMS_COMPLETED_INDEPENDENT_SEMANTIC_REVIEW_PENDING";
    } catch (error) {
        receipt.outcome = classifyStoppedRun(error, receipt.providerRequests);
        receipt.error = safeFailure(error);
    } finally {
        receipt.snapshotReads = snapshots.summary;
        const started = performance.now();
        try {
            await service?.close();
            receipt.supportedClose = "COMPLETE";
        } catch (error) {
            receipt.supportedClose = safeFailure(error);
        }
        receipt.closeMilliseconds = performance.now() - started;
        snapshots.restore();
        receipt.finishedEpochMs = Date.now();
        receipt.elapsedMs = receipt.finishedEpochMs - receipt.startedEpochMs;
        await persist();
    }
    return receipt;
}
