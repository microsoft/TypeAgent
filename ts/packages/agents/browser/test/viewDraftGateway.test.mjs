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

test("real views HTTP/parent IPC routes draft builds to the file-backed service owner", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "view-draft-gateway-"));
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
            generate: async (input) => {
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
    createRpc(
        "draft-view-test-parent",
        child,
        createMemoryViewFunctions(() => service),
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
    const source = await service.ingestDocument({
        corpusId: corpus.corpusId,
        source: {
            sourceId: "s",
            sourceType: "text",
            title: "Synthetic evidence",
            text: "Read only. No confirmed recovery. Fresh approval required.",
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
                    viewId: "guide",
                    kind: "troubleshootingGuide",
                    selector: {
                        kind: "sources",
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
    const views = await invoke("memoryListViews", {
        corpusId: corpus.corpusId,
    });
    assert.equal(
        views.body.data.views[0].generation.input.inputs[0].content,
        "Read only. No confirmed recovery. Fresh approval required.",
    );
    assert.equal(
        (await invoke("memoryBuildViews", { ...request, publication: "on" }))
            .status,
        400,
    );
    const html = await (await fetch(`${base}/library/memoryHub.html`)).text();
    const policy = await invoke("memoryGetViewPublicationPolicy", {
        corpusId: corpus.corpusId,
    });
    assert.equal(policy.status, 200);
    assert.equal(policy.body.data.autoPublish, true);
    const update = await invoke("memoryUpdateViewPublicationPolicy", {
        corpusId: corpus.corpusId,
        expectedHead: views.body.data.head,
        expectedRevision: 0,
        viewId: "guide",
        autoPublish: false,
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.data.views.guide.autoPublish, false);
    assert.equal(
        (
            await invoke("memoryPublishView", {
                corpusId: corpus.corpusId,
                viewId: "guide",
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
});
