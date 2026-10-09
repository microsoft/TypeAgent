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
import { FileMemoryService, waitForMemoryJob } from "@typeagent/memory-service";
import { FakeProcedureCorpusIndex } from "../../../memory/service/dist/test/fakeProcedureCorpusIndex.js";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";
import {
    projectBriefTestAnswer,
    projectSources,
} from "../../../memory/service/dist/test/projectBriefTestModel.js";
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
import { wikiTestAnswer } from "../../../memory/service/dist/test/wikiTestModel.js";

for (const kind of [
    "troubleshootingGuide",
    "projectBrief",
    "timeline",
    "wiki",
]) {
    test(`real views HTTP/parent IPC routes ${kind} builds to the file-backed service owner`, async (t) => {
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
            viewDrafts: true,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-gateway-test",
                ...(kind !== "troubleshootingGuide"
                    ? {
                          inventory: async (input) =>
                              hydrateInventory(
                                  input,
                                  (kind === "wiki"
                                      ? wikiTestAnswer
                                      : kind === "timeline"
                                        ? timelineTestAnswer
                                        : projectBriefTestAnswer)(
                                      "memory_source_fact_inventory",
                                      labelViewInput(
                                          input,
                                          retainedPassages(input),
                                      ),
                                  ),
                              ),
                          checkInventory: async (_input, inventory) =>
                              parseInventoryAudit(
                                  (kind === "wiki"
                                      ? wikiTestAnswer
                                      : kind === "timeline"
                                        ? timelineTestAnswer
                                        : projectBriefTestAnswer)(
                                      "memory_source_inventory_check",
                                      { inventory },
                                  ),
                              ),
                      }
                    : {}),
                generate: async (input, _signal, inventory) => {
                    if (kind !== "troubleshootingGuide")
                        return hydrateInventoryConstruction(
                            input,
                            inventory,
                            (kind === "wiki"
                                ? wikiTestAnswer
                                : kind === "timeline"
                                  ? timelineTestAnswer
                                  : projectBriefTestAnswer)(
                                kind === "wiki"
                                    ? "memory_wiki_construction"
                                    : kind === "timeline"
                                      ? "memory_timeline_construction"
                                      : "memory_project_brief_construction",
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
        createRpc("draft-view-test-parent", child, {
            ...createMemoryViewFunctions(() => service),
            memoryGetSourceContent: (request) =>
                service.getSourceContent(request),
            memoryListEvents: (request) => service.listEvents(request),
        });
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
        const request = {
            corpusId: corpus.corpusId,
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId,
                        kind,
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
        assert.equal(job.state, "complete");
        assert.equal(job.results[0].state, "draft");
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
        assert.deepEqual(
            (
                await invoke("memorySearchViews", {
                    corpusId: corpus.corpusId,
                    query: "Read only",
                    freshness: "current",
                })
            ).body.data,
            [],
        );
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
            assert.equal(published.status, 200);
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
            });
            assert.equal(original.status, 200);
            assert.equal(original.body.data.content, sourceText);
            assert.equal(latest.content.agentEdition, undefined);
        }
    });
}
