// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";
import { FileMemoryService, waitForMemoryJob } from "@typeagent/memory-service";
import { FakeSemanticCorpusIndex } from "../../../memory/service/dist/test/fakeSemanticCorpusIndex.js";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";
import { BrowserMemoryService } from "../dist/agent/browserMemoryService.mjs";
import { createMemoryHubSourceOriginalFunctions } from "../dist/agent/memoryHubSourceOriginal.mjs";
import { createMemoryHubViewUsageFunctions } from "../dist/agent/memoryHubViewUsage.mjs";
import { createMemoryHubFunctions } from "../dist/agent/memoryHub.mjs";
import { createMemoryHubExploreFunctions } from "../dist/agent/memoryHubExplore.mjs";
import { projectSources } from "../../../memory/service/dist/test/projectTestSources.js";
import { inventoryTestAnswer } from "../../../memory/service/dist/test/viewInventoryTestModel.js";
import { projectSummaryTestResponse } from "../../../memory/service/dist/test/informationalProjectTestModel.js";
import { FakeIndexedCorpusIndex } from "../../../memory/service/dist/test/fakeIndexedCorpusIndex.js";
import { hydrateProjectSummary } from "../../../memory/service/dist/informationalProject.js";
import { hydrateInformational } from "../../../memory/service/dist/informationalWiki.js";
import {
    hydrateInventory,
    parseInventoryAudit,
} from "../../../memory/service/dist/viewInventory.js";
import {
    labelViewInput,
    retainedPassages,
} from "../../../memory/service/dist/viewSynthesisEvidence.js";
import { hydrateInventoryConstruction } from "../../../memory/service/dist/viewInventoryCoverage.js";
import { timelineTestAnswer } from "../../../memory/service/dist/test/timelineTestModel.js";

for (const kind of [
    "troubleshootingGuide",
    "projectBrief",
    "timeline",
    "wiki",
]) {
    test(`default Browser Views capability admits real ${kind} builds through HTTP/parent IPC without enablement`, async (t) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "view-draft-gateway-"),
        );
        const viewId =
            kind === "timeline"
                ? "incident-timeline"
                : kind === "projectBrief"
                  ? "payments-brief"
                  : "guide";
        const sourceText =
            kind === "timeline"
                ? "## Record hypothesis\nClassification: hypothesis\nState: proposed\nOccurred at: 2026-10-05T08:45:00Z\nRecorded / known at: 2026-10-06T08:05:00Z\nOriginal unconfirmed query hypothesis."
                : kind === "projectBrief"
                  ? `${projectSources.charter}\n\n${projectSources.baseline}`
                  : "Read only. No confirmed recovery. Fresh approval required.";
        const roles = [
            "description",
            "prerequisites",
            "diagnostic",
            "guard",
            "verification",
            "recovery",
            "context",
        ];
        const service = new FileMemoryService(root, {
            informationalViews: kind === "projectBrief" || kind === "wiki",
            ...(kind === "projectBrief"
                ? {
                      informationalBudget: {
                          contextTokens: 21000,
                          inputTokens: 16000,
                          outputTokens: 4000,
                          safetyTokens: 1000,
                          chatAttempts: 4,
                          reservedTokens: 64000,
                          embeddingAttempts: 8,
                          elapsedMs: 60000,
                          tokenizer: "synthetic-gateway",
                          countTokens: (text) => Math.ceil(text.length / 3),
                      },
                  }
                : {}),
            indexFactory: (_id, directory) =>
                kind === "projectBrief" || kind === "wiki"
                    ? new FakeIndexedCorpusIndex(directory)
                    : new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-gateway-test",
                ...(kind === "timeline"
                    ? {
                          inventory: async (input) =>
                              hydrateInventory(
                                  input,
                                  (kind === "timeline"
                                      ? timelineTestAnswer
                                      : inventoryTestAnswer)(
                                      "memory_source_fact_inventory",
                                      labelViewInput(
                                          input,
                                          retainedPassages(input),
                                      ),
                                  ),
                              ),
                          checkInventory: async (_input, inventory) =>
                              parseInventoryAudit(
                                  (kind === "timeline"
                                      ? timelineTestAnswer
                                      : inventoryTestAnswer)(
                                      "memory_source_inventory_check",
                                      { inventory },
                                  ),
                              ),
                      }
                    : {}),
                generate: async (input, _signal, inventory) => {
                    if (kind === "wiki") {
                        assert.equal(input.pipeline, "informational-wiki-v1");
                        assert.equal(inventory, undefined);
                        return hydrateInformational(input, {
                            title: "Read only wiki",
                            prose: input.inputs
                                .map((source) => source.content)
                                .join("\n\n"),
                            limits: "Only selected indexed evidence",
                            citationIds: input.inputs
                                .flatMap((source) => source.passages ?? [])
                                .map((_, index) => `f${index}`),
                        });
                    }
                    if (kind === "projectBrief") {
                        assert.equal(
                            input.pipeline,
                            "informational-project-summary-v1",
                        );
                        assert.equal(inventory, undefined);
                        return hydrateProjectSummary(
                            input,
                            projectSummaryTestResponse(
                                input.inputs
                                    .flatMap((source) => source.passages ?? [])
                                    .map((passage) => ({
                                        text: passage.excerpt,
                                    })),
                            ),
                        );
                    }
                    if (kind !== "troubleshootingGuide")
                        return hydrateInventoryConstruction(
                            input,
                            inventory,
                            (kind === "timeline"
                                ? timelineTestAnswer
                                : inventoryTestAnswer)(
                                kind === "timeline"
                                    ? "memory_timeline_construction"
                                    : "memory_inventory_guide_construction",
                                { input, inventory },
                            ),
                        );
                    const source = input.inputs[0];
                    const citation = {
                        sourceId: source.sourceId,
                        revisionId: source.revisionId,
                        locator: `chars:0-${source.content.length}`,
                        excerpt: source.content,
                    };
                    return {
                        content: {
                            kind: "troubleshootingGuide",
                            title: "Synthetic gateway guide",
                            citations: [citation],
                            sections: roles.map((role) => ({
                                id: role,
                                role,
                                heading: role,
                                body: source.content,
                            })),
                        },
                        relationships: roles.map((role) => ({
                            id: `support-${role}`,
                            predicate: "supportedBy",
                            from: {
                                kind: "section",
                                viewId: input.definition.viewId,
                                sectionId: role,
                            },
                            to: {
                                kind: "source",
                                sourceId: source.sourceId,
                                revisionId: source.revisionId,
                            },
                            citations: [citation],
                        })),
                        outcome: "diagnosticOnly",
                        missingEvidence: ["No confirmed recovery"],
                    };
                },
                validate: async (_input, output) => ({
                    supported: true,
                    missingContext: [],
                    reasons: [],
                    exclusions: [],
                    sections: output.content.sections.map((section) => ({
                        sectionId: section.id,
                        supported: true,
                        reason: "Offline assessment",
                    })),
                    relationships: output.relationships.map((edge) => ({
                        edgeId: edge.id,
                        supported: true,
                        reason: "Offline assessment",
                    })),
                }),
            },
        });
        const child = fork(
            new URL("../dist/views/server/server.mjs", import.meta.url),
            ["0"],
            { stdio: ["ignore", "ignore", "inherit", "ipc"] },
        );
        t.after(async () => {
            if (child.exitCode === null) {
                const exited = once(child, "exit");
                child.kill();
                await exited;
            }
            await service.close();
            await rm(root, { recursive: true, force: true });
        });
        const browserMemory = new BrowserMemoryService(service);
        const capabilities = await browserMemory.getCapabilities();
        assert.ok(
            capabilities.derivedViews,
            "Default Browser memory must expose working Views without opt-in",
        );
        assert.equal(capabilities.derivedViews.drafts, true);
        assert.equal(capabilities.derivedViews.builds, true);
        assert.ok(capabilities.derivedViews.kinds.includes(kind));
        const handlers = {
            ...createMemoryViewFunctions(() => service),
            ...createMemoryHubSourceOriginalFunctions(() => service),
            ...createMemoryHubViewUsageFunctions(() => service),
            ...createMemoryHubExploreFunctions(() => service),
            memoryGetSourceContent: (request) =>
                service.getSourceContent(request),
            memoryListEvents: (request) => service.listEvents(request),
            memoryListCorpora: () => service.listCorpora(),
            memoryGetCorpus: ({ corpusId }) => service.getCorpus(corpusId),
            memoryGetSource: ({ corpusId, sourceId }) =>
                service.getSource(corpusId, sourceId),
            memoryListSources: (request) => service.listSourcesPage(request),
            memoryListJobs: (request) => service.listJobs(request),
            memoryListActivity: (request) =>
                browserMemory.listActivity(request),
        };
        Object.assign(handlers, createMemoryHubFunctions(handlers));
        createRpc(
            "draft-view-test-parent",
            child,
            Object.fromEntries(
                viewMethods
                    .filter((method) => method in handlers)
                    .map((method) => [method, handlers[method]]),
            ),
        );
        const ready = await new Promise((resolve, reject) => {
            child.on("message", (message) => {
                if (message.type === "Success") resolve(message);
            });
            child.once("error", reject);
            child.once("exit", () =>
                reject(new Error("Views server exited before readiness")),
            );
        });
        const base = `http://localhost:${ready.port}`;
        async function invoke(method, params) {
            const response = await fetch(`${base}/api/views/invoke`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ method, params }),
            });
            return { status: response.status, body: await response.json() };
        }
        const corpus = await service.createCorpus("Gateway synthetic fixture");
        if (kind === "wiki")
            await service.maintainViews({
                corpusId: corpus.corpusId,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
                family: "wiki",
                operation: "pause",
            });
        const source = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "s",
                sourceType: "text",
                title: "Synthetic evidence",
                text: sourceText,
            },
        });
        await waitForMemoryJob(service, source.jobId);
        assert.equal((await fetch(`${base}/api/health`)).status, 200);
        assert.equal(
            (await invoke("memoryViewCapabilities", {})).body.data.derivedViews
                .builds,
            true,
        );
        const events = await invoke("memoryListEvents", {
            corpusId: corpus.corpusId,
            pageSize: 200,
        });
        assert.equal(events.status, 200);
        assert.equal(events.body.success, true);
        assert.deepEqual(events.body.data.items, []);
        assert.equal(
            (
                await invoke("memoryGetSourceContent", {
                    corpusId: corpus.corpusId,
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    offset: 0,
                    maxChars: 100000,
                })
            ).status,
            200,
        );
        assert.equal(
            (
                await invoke("memoryGetSourceContent", {
                    corpusId: corpus.corpusId,
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    maxChars: 120000,
                })
            ).status,
            400,
        );
        const request = {
            corpusId: corpus.corpusId,
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId,
                        kind,
                        ...(kind === "wiki"
                            ? {
                                  wiki: {
                                      construction: "informational-wiki-v1",
                                      query: "Read only",
                                      aliases: [],
                                      excludedSourceIds: [],
                                  },
                              }
                            : {}),
                        ...(kind === "projectBrief"
                            ? {
                                  projectSummary: {
                                      construction:
                                          "informational-project-summary-v1",
                                      query: "Payments",
                                      aliases: [],
                                      excludedSourceIds: [],
                                  },
                              }
                            : {}),
                        selector: {
                            kind:
                                kind === "timeline"
                                    ? "timelineEvidence"
                                    : "sources",
                            ...(kind === "timeline" ? { events: [] } : {}),
                            sources: [
                                {
                                    sourceId: source.sourceId,
                                    revisionId: source.revisionId,
                                },
                            ],
                        },
                    },
                },
            ],
            publication: false,
        };
        assert.equal(
            (await invoke("memoryBuildViews", { ...request, actor: "spoofed" }))
                .status,
            400,
        );
        if (kind === "wiki") {
            const obsolete = structuredClone(request);
            delete obsolete.targets[0].definition.wiki;
            assert.equal(
                (await invoke("memoryBuildViews", obsolete)).status,
                400,
            );
            const unsupported = structuredClone(request);
            unsupported.targets[0].definition.wiki.construction = "wiki-v1";
            assert.equal(
                (await invoke("memoryBuildViews", unsupported)).status,
                400,
            );
        }
        if (kind === "projectBrief") {
            const obsolete = structuredClone(request);
            delete obsolete.targets[0].definition.projectSummary;
            assert.equal(
                (await invoke("memoryBuildViews", obsolete)).status,
                400,
            );
            const unsupported = structuredClone(request);
            unsupported.targets[0].definition.projectSummary.construction =
                "project-brief-v1";
            assert.equal(
                (await invoke("memoryBuildViews", unsupported)).status,
                400,
            );
        }
        const admitted = await invoke("memoryBuildViews", request);
        assert.equal(admitted.status, 200);
        let job = admitted.body.data;
        while (job.state === "running") {
            await new Promise((resolve) => setTimeout(resolve, 20));
            const status = await invoke("memoryGetViewBuild", {
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            });
            assert.equal(status.status, 200);
            job = status.body.data;
        }
        assert.equal(job.state, "complete", JSON.stringify(job.results));
        assert.equal(job.results[0].state, "draft");
        const original = await invoke("memoryHubSourceOriginal", {
            corpusId: corpus.corpusId,
            sourceId: source.sourceId,
            revisionId: source.revisionId,
            locator: "chars:0-10",
        });
        assert.equal(original.status, 200);
        assert.equal(original.body.data.available, true);
        assert.equal(original.body.data.content, sourceText);
        assert.deepEqual(original.body.data.location, {
            kind: "characters",
            start: 0,
            end: 10,
        });
        const usage = await invoke("memoryHubViewUsedBy", {
            corpusId: corpus.corpusId,
            sourceId: source.sourceId,
        });
        assert.equal(usage.status, 200);
        assert.ok(
            usage.body.data.items.some(
                (item) => item.viewId === viewId && item.revisionId,
            ),
        );
        assert.ok(
            usage.body.data.items.some((item) => item.jobId === job.jobId),
        );
        assert.equal(usage.body.data.total, usage.body.data.items.length);
        assert.ok(!Object.hasOwn(usage.body.data, "views"));
        if (kind === "timeline") {
            const rejected = await invoke("memoryBuildViews", {
                ...request,
                bounds: { learnedBefore: "2026-10-05T12:00:00" },
            });
            assert.equal(rejected.status, 400);
            const canonical = await service.appendEvent({
                corpusId: corpus.corpusId,
                idempotencyKey: "canonical-timeline-observation",
                producer: { producerId: "observer", producerType: "test" },
                sourceKind: "system",
                eventType: "configuration",
                eventTime: "2026-10-05T08:45:00Z",
                observedAt: "2026-10-06T08:05:00Z",
                content: "Canonical configuration correction.",
            });
            const selection = await invoke("memoryListEvents", {
                corpusId: corpus.corpusId,
            });
            assert.equal(
                selection.body.data.items[0].eventId,
                canonical.event.eventId,
            );
            const canonicalBuild = await invoke("memoryBuildViews", {
                corpusId: corpus.corpusId,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
                publication: false,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "canonical-timeline",
                            kind: "timeline",
                            selector: {
                                kind: "timelineEvidence",
                                sources: [],
                                events: [{ eventId: canonical.event.eventId }],
                            },
                        },
                    },
                ],
            });
            let result = canonicalBuild.body.data;
            while (result.state === "running") {
                await new Promise((resolve) => setTimeout(resolve, 20));
                result = (
                    await invoke("memoryGetViewBuild", {
                        corpusId: corpus.corpusId,
                        jobId: result.jobId,
                    })
                ).body.data;
            }
            assert.equal(result.results[0].state, "draft");
            assert.equal(
                (
                    await service.getView({
                        corpusId: corpus.corpusId,
                        viewId: "canonical-timeline",
                    })
                ).content.sections[0].id,
                canonical.event.eventId,
            );
        }
        const views = await invoke("memoryListViews", {
            corpusId: corpus.corpusId,
        });
        assert.equal(
            views.body.data.views[0].generation.input.inputs[0].content,
            sourceText,
        );
        assert.equal(
            (
                await invoke("memoryBuildViews", {
                    ...request,
                    publication: "on",
                })
            ).status,
            400,
        );
        const html = await (
            await fetch(`${base}/library/memoryHub.html`)
        ).text();
        const policy = await invoke("memoryGetViewPublicationPolicy", {
            corpusId: corpus.corpusId,
        });
        assert.equal(policy.status, 200);
        assert.equal(policy.body.data.autoPublish, true);
        const update = await invoke("memoryUpdateViewPublicationPolicy", {
            corpusId: corpus.corpusId,
            expectedHead: views.body.data.head,
            expectedRevision: 0,
            viewId,
            autoPublish: false,
        });
        assert.equal(update.status, 200);
        assert.equal(update.body.data.views[viewId].autoPublish, false);
        assert.equal(
            (
                await invoke("memoryPublishView", {
                    corpusId: corpus.corpusId,
                    viewId,
                    actor: "spoof",
                })
            ).status,
            400,
        );
        const visible = (
            await invoke("memorySearchViews", {
                corpusId: corpus.corpusId,
                query: kind === "projectBrief" ? "Payments" : "Read only",
                freshness: "current",
            })
        ).body.data;
        if (kind === "wiki") {
            assert.equal(visible.length, 1);
            assert.equal(
                visible[0].view.content.construction,
                "informational-wiki-v1",
            );
            const citation = visible[0].evidence[0];
            const resolved = await invoke("memoryGetSourceContent", {
                corpusId: corpus.corpusId,
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
                indexedLocator: citation.locator,
            });
            assert.equal(resolved.status, 200);
            assert.equal(resolved.body.data.content, citation.excerpt);
            const oldMaintenance = await invoke("memoryUpdateViewMaintenance", {
                corpusId: corpus.corpusId,
                viewId,
                expectedHead: views.body.data.head,
                expectedVersion: visible[0].view.version,
                maintenance: {
                    schemaVersion: 1,
                    scope: { mode: "pinned" },
                    wikiDiscovery: {
                        rules: "explicit-subjects-v1",
                        subjects: [],
                        createDraftPages: false,
                    },
                },
            });
            assert.equal(oldMaintenance.status, 400);
            return;
        }
        if (kind === "projectBrief") {
            assert.equal(visible.length, 1);
            assert.equal(
                visible[0].view.content.construction,
                "informational-project-summary-v1",
            );
        } else assert.deepEqual(visible, []);
        assert.match(html, /hubDraftViews/);
        if (kind === "projectBrief") {
            const view = views.body.data.views[0];
            assert.equal(view.content.kind, "projectBrief");
            assert.equal(
                view.content.sections.find(
                    (section) => section.role === "status",
                ).details.capacity,
                "pendingOwnerReview",
            );
            const saved = await invoke("memorySaveViewDraft", {
                corpusId: corpus.corpusId,
                viewId,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
                expectedVersion: view.version,
                definition: request.targets[0].definition,
                content: {
                    ...view.content,
                    title: "Payments reliability reading brief",
                },
                relationships: view.relationships
                    .filter((edge) => edge.origin !== "system")
                    .map(({ id, predicate, from, to, citations }) => ({
                        id,
                        predicate,
                        from,
                        to,
                        citations,
                    })),
            });
            assert.equal(saved.status, 200);
            const latest = saved.body.data.version;
            const published = await invoke("memoryPublishView", {
                corpusId: corpus.corpusId,
                viewId,
                revisionId: latest.revisionId,
                expectedVersion: latest.version,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
            });
            assert.equal(published.status, 200, JSON.stringify(published.body));
            const found = await invoke("memorySearchViews", {
                corpusId: corpus.corpusId,
                query: "Payments reliability",
                freshness: "current",
                kinds: ["projectBrief"],
            });
            assert.equal(found.status, 200);
            assert.equal(found.body.data[0].view.revisionId, latest.revisionId);
            const citation = found.body.data[0].evidence[0];
            const original = await invoke("memoryGetSourceContent", {
                corpusId: corpus.corpusId,
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
                indexedLocator: citation.locator,
            });
            assert.equal(original.status, 200);
            assert.equal(original.body.data.content, citation.excerpt);
            assert.equal(latest.content.agentEdition, undefined);
            return;
        }
        const maintenanceSnapshot = await service.listViews(corpus.corpusId);
        const maintained = maintenanceSnapshot.views.find(
            (view) => view.viewId === viewId,
        );
        const definitionUpdate = await invoke("memoryUpdateViewMaintenance", {
            corpusId: corpus.corpusId,
            viewId,
            expectedHead: maintenanceSnapshot.head,
            expectedVersion: maintained.version,
            maintenance: {
                schemaVersion: 1,
                scope: { mode: "currentSources", sourceIds: ["s"] },
            },
        });
        assert.equal(definitionUpdate.status, 200);
        const maintenancePlan = await invoke("memoryPlanViewMaintenance", {
            corpusId: corpus.corpusId,
            viewIds: [viewId],
        });
        assert.equal(maintenancePlan.status, 200);
        assert.equal(maintenancePlan.body.data.targets[0].state, "rebuild");
        const maintenanceRequest = {
            corpusId: corpus.corpusId,
            expectedHead: maintenancePlan.body.data.expectedHead,
            targets: maintenancePlan.body.data.targets.map(
                ({ viewId, expectedVersion }) => ({ viewId, expectedVersion }),
            ),
        };
        assert.equal(
            (
                await invoke("memoryMaintainViews", {
                    ...maintenanceRequest,
                    actor: "spoof",
                })
            ).status,
            400,
        );
        const maintenanceReceipt = await invoke(
            "memoryMaintainViews",
            maintenanceRequest,
        );
        assert.equal(
            maintenanceReceipt.status,
            200,
            JSON.stringify(maintenanceReceipt.body),
        );
        let maintainedJob = maintenanceReceipt.body.data.job;
        while (maintainedJob.state === "running") {
            await new Promise((resolve) => setTimeout(resolve, 20));
            maintainedJob = (
                await invoke("memoryGetViewBuild", {
                    corpusId: corpus.corpusId,
                    jobId: maintainedJob.jobId,
                })
            ).body.data;
        }
        assert.ok(
            ["draft", "merged"].includes(maintainedJob.results[0].state),
            maintainedJob.results[0].reason,
        );
        const noOp = await invoke("memoryPlanViewMaintenance", {
            corpusId: corpus.corpusId,
            viewIds: [viewId],
        });
        assert.equal(noOp.body.data.targets[0].state, "unchanged");
        const storedReceipt = await invoke("memoryGetViewMaintenance", {
            corpusId: corpus.corpusId,
            receiptId: maintenanceReceipt.body.data.receiptId,
        });
        assert.equal(storedReceipt.status, 200);
        assert.equal(storedReceipt.body.data.job.state, "complete");
        if (process.env.TYPEAGENT_TEST_BROWSER_WORKFLOW === "true") {
            const { verifyViewBuildBrowserWorkflow } = await import(
                "./viewBuildBrowserWorkflow.mjs"
            );
            await verifyViewBuildBrowserWorkflow(
                base,
                corpus.corpusId,
                kind,
                service,
            );
        }
    });
}
