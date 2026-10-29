// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    browserViews,
    getBrowserViewDestination,
} from "@typeagent/browser-control-rpc/viewRoutes";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";
import { understandingStages } from "../dist/views/server/features/views/viewRoutes.mjs";

test("opt-in lexical preview yields before semantic retrieval without replacing its prepared handle", async () => {
    const phases = [];
    const id = "00000000-0000-4000-8000-000000000001";
    const input = { corpusId: "corpus", question: "Explain the gallery" };
    const stages = understandingStages(
        input,
        async ({ params }) => {
            phases.push(params.phase);
            return {
                ...input,
                schemaVersion: 1,
                snapshotId: id,
                turnId: id,
                expiresAt: "2099-01-01T00:00:00.000Z",
                citations: [],
                modules: [],
                warnings: [],
                ...(params.phase === "preview"
                    ? { provisional: true }
                    : { evidenceSnapshotId: id }),
            };
        },
        undefined,
        true,
    );
    const preview = (await stages.next()).value;
    assert.equal(preview.provisional, true);
    assert.equal(preview.evidenceSnapshotId, undefined);
    assert.deepEqual(phases, ["preview"]);
    await stages.next();
    await stages.next();
    assert.deepEqual(phases, ["preview", "retrieve", "initial"]);
    assert.equal((await stages.next()).done, true);
});

test("progressive understanding yields before subsequent reads and carries prepared handles across refinement", async () => {
    const calls = [];
    const id = "00000000-0000-4000-8000-000000000001";
    const input = { corpusId: "corpus", question: "Explain the gallery" };
    const stages = understandingStages(input, async ({ params }) => {
        calls.push(params);
        return {
            ...input,
            schemaVersion: 1,
            snapshotId: id,
            turnId: id,
            evidenceSnapshotId: id,
            expiresAt: "2099-01-01T00:00:00.000Z",
            citations: [],
            modules: [],
            warnings: [],
            refinementPending: params.phase === "initial",
        };
    });
    assert.equal((await stages.next()).done, false);
    assert.deepEqual(
        calls.map((item) => item.phase),
        ["retrieve"],
    );
    assert.equal((await stages.next()).value.refinementPending, true);
    assert.equal(calls[1].evidenceSnapshotId, id);
    assert.equal((await stages.next()).done, false);
    assert.equal(calls[2].phase, "refine");
    assert.equal(calls[2].evidenceSnapshotId, id);
    assert.equal((await stages.next()).done, true);
});

test("disconnect cancellation prevents the next progressive phase", async () => {
    const controller = new AbortController();
    let calls = 0;
    const id = "00000000-0000-4000-8000-000000000001";
    const input = { corpusId: "corpus", question: "Explain" };
    const stages = understandingStages(
        input,
        async () => {
            calls++;
            return {
                ...input,
                schemaVersion: 1,
                snapshotId: id,
                turnId: id,
                evidenceSnapshotId: id,
                expiresAt: "2099-01-01T00:00:00.000Z",
                citations: [],
                modules: [],
                warnings: [],
            };
        },
        controller.signal,
    );
    await stages.next();
    controller.abort(new Error("disconnected"));
    await assert.rejects(stages.next(), /disconnected/);
    assert.equal(calls, 1);
});

test("Understanding cancellation is a strict, collection-scoped operation", () => {
    const request = {
        method: "memoryHubCancelUnderstanding",
        params: {
            corpusId: "corpus",
            requestId: "00000000-0000-4000-8000-000000000001",
        },
    };
    assert.deepEqual(validateViewRequest(request), request);
    assert.throws(() =>
        validateViewRequest({
            ...request,
            params: { ...request.params, requestId: "not-an-id" },
        }),
    );
});

test("closing the progressive iterator prevents scheduling another model phase", async () => {
    let calls = 0;
    const id = "00000000-0000-4000-8000-000000000001";
    const input = { corpusId: "corpus", question: "Explain" };
    const stages = understandingStages(input, async () => {
        calls++;
        return {
            ...input,
            schemaVersion: 1,
            snapshotId: id,
            turnId: id,
            evidenceSnapshotId: id,
            expiresAt: "2099-01-01T00:00:00.000Z",
            citations: [],
            modules: [],
            warnings: [],
        };
    });
    await stages.next();
    await stages.return();
    assert.equal(calls, 1);
});

test("understanding crosses the strict gateway without silently broadening scope", () => {
    for (const [method, params] of [
        [
            "memoryHubUnderstand",
            {
                corpusId: "corpus",
                question: "Explain the migration",
                selection: {
                    mode: "only",
                    modules: ["relationships", "concepts"],
                },
            },
        ],
        [
            "memoryHubUnderstandingModule",
            {
                corpusId: "corpus",
                snapshotId: "00000000-0000-4000-8000-000000000001",
                kind: "concepts",
            },
        ],
    ])
        assert.equal(validateViewRequest({ method, params }).method, method);
    for (const params of [
        { question: "Explain the migration" },
        {
            corpusId: "corpus",
            question: "Explain the migration",
            tags: ["hidden-filter"],
        },
        { corpusId: "corpus", question: "Explain", conversationScope: "all" },
        {
            corpusId: "corpus",
            question: "Explain",
            parentSnapshotId: "00000000-0000-4000-8000-000000000001",
        },
    ])
        assert.throws(() =>
            validateViewRequest({ method: "memoryHubUnderstand", params }),
        );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubUnderstandingModule",
            params: {
                corpusId: "corpus",
                snapshotId: "00000000-0000-4000-8000-000000000001",
                kind: "arbitraryHtml",
            },
        }),
    );
});

test("topic browse/rebuild and maintenance cross strict gateway with honest bounds", () => {
    for (const [method, params] of [
        [
            "memoryQueryTopics",
            {
                corpusId: "corpus",
                pageSize: 200,
                depth: 10,
                continuationToken: "generation-token",
            },
        ],
        ["memoryRebuildTopics", { corpusId: "corpus" }],
        [
            "memoryQueryTopics",
            {
                corpusId: "corpus",
                curated: true,
                topicId: "concept:one",
                summarize: true,
            },
        ],
        [
            "memoryMaintainViews",
            {
                corpusId: "corpus",
                expectedHead: null,
                family: "topics",
                operation: "resume",
            },
        ],
    ]) {
        assert.deepEqual(validateViewRequest({ method, params }), {
            method,
            params,
        });
    }
    for (const params of [
        { corpusId: "corpus", pageSize: 201 },
        { corpusId: "corpus", depth: 11 },
        { corpusId: "corpus", sources: ["display-cap"] },
        { corpusId: "corpus", summarize: true },
        {
            corpusId: "corpus",
            curated: true,
            topicId: "concept:one",
            summarize: true,
            continuationToken: "token",
        },
    ])
        assert.throws(() =>
            validateViewRequest({ method: "memoryQueryTopics", params }),
        );
});

test("source synopsis exact revision read crosses the strict HTTP gateway without accepting derived citations", () => {
    const params = {
        corpusId: "corpus",
        sourceId: "source",
        revisionId: "revision",
    };
    assert.deepEqual(
        validateViewRequest({ method: "memoryGetSourceSynopsis", params })
            .params,
        params,
    );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryGetSourceSynopsis",
            params: { ...params, locator: "chars:0-10" },
        }),
    );
});

test("indexed Search/Ask citations preserve their exact locator through the HTTP gateway", () => {
    const params = {
        corpusId: "corpus",
        kind: "source",
        objectId: "source",
        revisionId: "revision",
        locator: `indexed:0:${"a".repeat(64)}:18-42`,
        offset: 0,
    };
    assert.deepEqual(
        validateViewRequest({ method: "memoryHubEvidence", params }),
        { method: "memoryHubEvidence", params },
    );
    for (const locator of [
        "indexed:0:bad:18-42",
        `indexed:-1:${"a".repeat(64)}:18-42`,
        "latest",
    ]) {
        assert.throws(() =>
            validateViewRequest({
                method: "memoryHubEvidence",
                params: { ...params, locator },
            }),
        );
    }
});

test("informational indexed evidence and family operations pass the strict browser gateway", () => {
    const build = {
        corpusId: "corpus",
        expectedHead: null,
        targets: [
            {
                expectedVersion: 0,
                definition: {
                    viewId: "page",
                    kind: "wiki",
                    selector: {
                        kind: "sources",
                        sources: [
                            { sourceId: "source", revisionId: "revision" },
                        ],
                    },
                    wiki: {
                        construction: "informational-wiki-v1",
                        query: "concept",
                        aliases: [],
                        excludedSourceIds: [],
                    },
                },
            },
        ],
    };
    assert.deepEqual(
        validateViewRequest({ method: "memoryBuildViews", params: build })
            .params,
        build,
    );
    const old = structuredClone(build);
    delete old.targets[0].definition.wiki;
    assert.throws(() =>
        validateViewRequest({ method: "memoryBuildViews", params: old }),
    );
    const oldVersion = structuredClone(build);
    oldVersion.targets[0].definition.wiki.construction = "wiki-v1";
    assert.throws(() =>
        validateViewRequest({ method: "memoryBuildViews", params: oldVersion }),
    );
    const params = {
        corpusId: "corpus",
        sourceId: "source",
        revisionId: "revision",
        indexedLocator: `indexed:0:${"a".repeat(64)}:0-2000`,
    };
    assert.deepEqual(
        validateViewRequest({ method: "memoryGetSourceContent", params })
            .params,
        params,
    );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryGetSourceContent",
            params: { ...params, indexedLocator: "made-up" },
        }),
    );
    for (const kind of ["wiki", "projects"])
        for (const operation of ["update", "pause", "resume", "rebuild"]) {
            const family = {
                corpusId: "corpus",
                expectedHead: null,
                family: kind,
                operation,
            };
            assert.deepEqual(
                validateViewRequest({
                    method: "memoryMaintainViews",
                    params: family,
                }).params,
                family,
            );
            assert.throws(() =>
                validateViewRequest({
                    method: "memoryMaintainViews",
                    params: { ...family, approval: true },
                }),
            );
        }
});
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";

const removedMethods = [
    "memoryGetHowToSettings",
    "memoryUpdateHowToSettings",
    "memoryCreateProcedureCandidate",
    "memoryListProcedureCandidates",
    "memoryRejectProcedureCandidate",
    "memorySaveProcedure",
    "memoryListProcedures",
    "memoryGetProcedure",
    "memorySearchProcedures",
    "memoryArchiveProcedure",
    "memoryHubRunbooks",
    "memoryHubRunbook",
    "memoryHubSaveRunbook",
    "memoryHubRunbookHistory",
    "memoryHubRunbookOriginal",
    "memoryHubRunbookUsedBy",
    "memoryHubSuggestBindings",
    "memoryHubAcceptBinding",
    "memoryHubPreviewSkill",
    "memoryHubPublishSkill",
    "memoryHubSkillAction",
    "memoryHubSkillFile",
    "memoryHubCompareRunbook",
    "memoryHubSynthesizeRunbook",
    "memoryHubReadRunbookAsset",
    "memoryHubRunbookJobs",
    "memoryHubRetryRunbookSynthesis",
];

test("legacy guide APIs and procedure evidence have no gateway contract", () => {
    for (const method of removedMethods) {
        assert.ok(!viewMethods.includes(method), method);
        assert.throws(
            () =>
                validateViewRequest({
                    method,
                    params: { corpusId: "c" },
                }),
            undefined,
            method,
        );
    }
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubEvidence",
            params: {
                corpusId: "c",
                kind: "procedure",
                objectId: "p",
                procedureVersion: 1,
            },
        }),
    );
    assert.throws(() =>
        validateViewRequest({
            method: "memoryHubStartRunbookImport",
            params: {
                corpusId: "c",
                idempotencyKey: "sources",
                kind: "urls",
                urls: ["https://example.invalid"],
                detectCandidates: true,
            },
        }),
    );
});

test("view validation rejects generic operations and malformed domain payloads", () => {
    for (const body of [
        { method: "openTab", params: { url: "https://example.com" } },
        { method: "toString", params: {} },
        { method: "memoryGetCorpus", params: {} },
        { method: "memoryHubSnapshot", params: { corpusId: 123 } },
        { method: "memoryHubSources", params: { pageSize: 0 } },
        { method: "memoryHubSources", params: { sourceTypes: ["pdf"] } },
        {
            method: "memoryHubSearch",
            params: { query: "worker", conversationId: "spoofed" },
        },
        {
            method: "memoryHubSearch",
            params: { query: "worker", dateFrom: "not a date" },
        },
        { method: "memoryHubSearch", params: { query: "worker", limit: 101 } },
        {
            method: "memoryHubEvidence",
            params: {
                corpusId: "c",
                kind: "conversation",
                objectId: "e",
                revisionId: "wrong-kind",
            },
        },
        { method: "memoryHubExplore", params: { maxNodes: 5001 } },
        {
            method: "memoryHubGraph",
            params: { kind: "entities", maxNodes: 251 },
        },
        { method: "memoryHubGraph", params: { kind: "topics", maxEdges: 501 } },
        {
            method: "memoryHubGraph",
            params: { kind: "hierarchy", maxNodes: 0 },
        },
        { method: "memoryHubGraph", params: { kind: "unknown" } },
        {
            method: "memoryHubGraph",
            params: {
                corpusId: "c",
                kind: "entities",
                pageBy: "edges",
                maxNodes: 1,
            },
        },
        {
            method: "memoryHubGraph",
            params: { corpusId: "c", kind: "entities", pageBy: "invalid" },
        },
        {
            method: "memoryHubGraph",
            params: { kind: "entities", continuationToken: "unscoped-page" },
        },
        {
            method: "memoryHubGraph",
            params: {
                kind: "topics",
                expectedGeneration: "unscoped-generation",
            },
        },
        {
            method: "memoryHubGraph",
            params: { kind: "entities", corpusId: null },
        },
        {
            method: "memoryHubGraph",
            params: {
                kind: "entities",
                eventFilter: { authorities: ["trusted"] },
            },
        },
        {
            method: "memoryHubGraphSupport",
            params: {
                corpusId: "c",
                generation: "g",
                nodeId: "n",
                pageSize: 51,
            },
        },
        {
            method: "memoryHubGraphSupport",
            params: { corpusId: "c", generation: "g" },
        },
        {
            method: "memoryHubGraphEvent",
            params: { corpusId: "c", eventId: "e", offset: -1 },
        },
        {
            method: "memoryHubGraphEvent",
            params: { corpusId: "c", eventId: "e", revisionId: "document" },
        },
        { method: "memoryHubKnowledge", params: { kind: "unknown" } },
        {
            method: "memoryHubKnowledge",
            params: { kind: "entities", pageSize: 101 },
        },
        {
            method: "memoryHubKnowledge",
            params: { kind: "topics", offset: -1 },
        },
        {
            method: "memoryHubKnowledge",
            params: { kind: "topics", query: "x".repeat(513) },
        },
        {
            method: "memoryHubKnowledge",
            params: { kind: "topics", browserOnly: true, corpusId: "a" },
        },
        { method: "memoryHubChanges", params: { pageSize: 0 } },
        {
            method: "memoryHubCapturePage",
            params: { url: "https://arbitrary.invalid" },
        },
        { method: "memoryHubCapturePage", params: {} },
        {
            method: "memoryHubCapturePage",
            params: { pageId: "tab:1", expectedUrl: "not a URL" },
        },
        { method: "memoryHubCapturePages", params: { corpusId: "spoofed" } },
        { method: "approveAutomation", params: { id: 123 } },
        { method: "listAutomations", params: { url: "https://example.com" } },
        { method: "getAllWebFlows", params: {} },
        {
            method: "memoryCreateProcedureCandidate",
            params: {
                corpusId: "c",
                title: "t",
                steps: ["s"],
                citations: [{ sourceId: 5 }],
            },
        },
        { method: "cancelImport", params: { importId: "..\\outside" } },
        {
            method: "importHtmlFolder",
            params: { folderPath: "folder", options: { mode: "full" } },
        },
    ]) {
        assert.throws(
            () => validateViewRequest(body),
            undefined,
            JSON.stringify(body),
        );
    }
    assert.deepEqual(
        validateViewRequest({
            method: "memoryGetCorpus",
            params: { corpusId: "c" },
        }),
        { method: "memoryGetCorpus", params: { corpusId: "c" } },
    );
    assert.deepEqual(
        validateViewRequest({
            method: "memoryHubSnapshot",
            params: {},
        }),
        { method: "memoryHubSnapshot", params: {} },
    );
    for (const body of [
        { method: "memoryHubGraph", params: { kind: "entities" } },
        {
            method: "memoryHubGraph",
            params: {
                kind: "hierarchy",
                corpusId: "c",
                evidenceKinds: ["document", "event"],
                maxNodes: 250,
                maxEdges: 500,
            },
        },
        {
            method: "memoryHubGraphSupport",
            params: {
                corpusId: "c",
                generation: "g",
                nodeId: "n",
                pageSize: 50,
            },
        },
        {
            method: "memoryHubGraphEvent",
            params: { corpusId: "c", eventId: "e", offset: 0 },
        },
    ]) {
        assert.deepEqual(validateViewRequest(body), body);
    }
    assert.doesNotThrow(() =>
        validateViewRequest({
            method: "importHtmlFolder",
            params: {
                folderPath: "C:\\fixtures\\html",
                options: { mode: "content", maxFileSize: 50 * 1024 * 1024 },
            },
        }),
    );
    assert.doesNotThrow(() =>
        validateViewRequest({
            method: "importWebsiteDataWithProgress",
            params: {
                source: "chrome",
                type: "history",
                importId: "fixture",
                contentTimeout: 120000,
            },
        }),
    );
});

test(
    "localhost HTTP gateway invokes parent RPC and forwards progress SSE",
    { timeout: 20_000 },
    async (t) => {
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
        });
        const graphCalls = [];
        const rpc = createRpc("view-test-parent", child, {
            memoryListCorpora: async () => [
                { corpusId: "c", name: "Test corpus" },
            ],
            memoryHubSnapshot: async () => ({
                corpora: [{ corpusId: "c", name: "Test corpus" }],
                inbox: [],
                errors: [],
            }),
            memoryHubSearch: async (params) => ({
                query: params.query,
                matches: [],
                warnings: [],
                ranking: "reciprocal-rank-fusion",
                errors: [],
            }),
            memoryHubEvidence: async (params) => ({
                title: "Retained evidence",
                content: "Original",
                offset: 0,
                totalChars: 8,
                provenance: params,
            }),
            memoryHubExplore: async () => ({
                counts: { sources: 0 },
                errors: [],
            }),
            memoryHubGraph: async (params) => {
                graphCalls.push(["memoryHubGraph", params]);
                return {
                    corpora: [],
                    errors: [],
                    omittedCorpora: 0,
                    presetLayout: { elements: [] },
                };
            },
            memoryHubGraphSupport: async (params) => {
                graphCalls.push(["memoryHubGraphSupport", params]);
                return { generation: params.generation, items: [], total: 0 };
            },
            memoryHubGraphEvent: async (params) => {
                graphCalls.push(["memoryHubGraphEvent", params]);
                return {
                    title: "Original event",
                    content: "{}",
                    offset: params.offset ?? 0,
                    totalChars: 2,
                };
            },
            memoryHubChanges: async () => ({ items: [], total: 0, errors: [] }),
            memoryHubCapturePage: async () => ({
                corpusId: "c",
                sourceId: "s",
                warnings: [],
            }),
            memoryHubCapturePages: async () => ({
                pages: [
                    {
                        pageId: "tab:1",
                        url: "https://example.invalid",
                        title: "Example",
                    },
                ],
            }),
            memoryCreateCorpus: async () => {
                throw new Error("Domain failure");
            },
            importWebsiteDataWithProgress: async (params) => ({
                importId: params.importId,
                complete: true,
            }),
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
        const invoke = (body, headers = {}) =>
            fetch(`${base}/api/views/invoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...headers },
                body: JSON.stringify(body),
            });
        await t.test(
            "removed APIs are rejected and the legacy asset route is absent",
            async () => {
                for (const method of removedMethods) {
                    const response = await invoke({
                        method,
                        params: { corpusId: "c" },
                    });
                    assert.equal(response.status, 400, method);
                }
                const asset = await fetch(`${base}/api/views/runbook-asset`);
                assert.equal(asset.status, 404);
            },
        );
        await t.test(
            "Memory Hub snapshot is exposed as a typed domain operation",
            async () => {
                const response = await invoke({
                    method: "memoryHubSnapshot",
                    params: {},
                });
                assert.equal(response.status, 200);
                assert.deepEqual(await response.json(), {
                    success: true,
                    data: {
                        corpora: [{ corpusId: "c", name: "Test corpus" }],
                        inbox: [],
                        errors: [],
                    },
                });
            },
        );
        await t.test(
            "scoped graphs and lazy event evidence cross HTTP and parent RPC",
            async () => {
                const requests = [
                    [
                        "memoryHubGraph",
                        {
                            kind: "entities",
                            corpusId: "c",
                            maxNodes: 250,
                            maxEdges: 500,
                        },
                    ],
                    [
                        "memoryHubGraphSupport",
                        {
                            corpusId: "c",
                            generation: "g",
                            nodeId: "n",
                            pageSize: 50,
                        },
                    ],
                    [
                        "memoryHubGraphEvent",
                        { corpusId: "c", eventId: "e", offset: 0 },
                    ],
                ];
                for (const [method, params] of requests) {
                    const response = await invoke({ method, params });
                    assert.equal(response.status, 200);
                    assert.equal((await response.json()).success, true);
                }
                assert.deepEqual(graphCalls, requests);
            },
        );
        await t.test(
            "Phase 2 typed reads and current-page capture cross HTTP and parent RPC",
            async () => {
                for (const [method, params] of [
                    [
                        "memoryHubSearch",
                        { query: "worker", conversationScope: "current" },
                    ],
                    [
                        "memoryHubEvidence",
                        {
                            corpusId: "c",
                            kind: "source",
                            objectId: "s",
                            revisionId: "r1",
                        },
                    ],
                    ["memoryHubExplore", { corpusId: "c", maxNodes: 200 }],
                    ["memoryHubChanges", { corpusId: "c", pageSize: 25 }],
                    ["memoryHubCapturePages", {}],
                    [
                        "memoryHubCapturePage",
                        {
                            pageId: "tab:1",
                            expectedUrl: "https://example.invalid",
                        },
                    ],
                ]) {
                    const response = await invoke({ method, params });
                    assert.equal(response.status, 200, method);
                    const body = await response.json();
                    assert.equal(body.success, true);
                    if (method === "memoryHubEvidence")
                        assert.equal(body.data.provenance.revisionId, "r1");
                    if (method === "memoryHubSearch")
                        assert.equal(body.data.query, "worker");
                }
            },
        );
        await t.test(
            "canonical and legacy view routes redirect without dropping the query",
            async () => {
                for (const name of [
                    "memoryCenter",
                    "knowledgeLibrary",
                    "entityGraph",
                    "topicGraph",
                ]) {
                    const view = browserViews[name];
                    for (const route of [
                        view.path,
                        `/views/${view.page}`,
                        `/${view.page}`,
                        `/library/${view.page}`,
                    ]) {
                        const response = await fetch(
                            `${base}${route}?topic=one%20two`,
                            { redirect: "manual" },
                        );
                        assert.equal(response.status, 302);
                        assert.equal(
                            response.headers.get("location"),
                            `/library/memoryHub.html?topic=one%20two&legacyView=${name}`,
                        );
                    }
                }
            },
        );
        await t.test(
            "typed domain invoke succeeds over child-process IPC",
            async () => {
                const response = await invoke(
                    { method: "memoryListCorpora", params: {} },
                    { Origin: base },
                );
                assert.equal(response.status, 200);
                assert.deepEqual(await response.json(), {
                    success: true,
                    data: [{ corpusId: "c", name: "Test corpus" }],
                });
                assert.match(
                    response.headers.get("content-security-policy"),
                    /connect-src 'self'/,
                );
                assert.equal(
                    response.headers.get("access-control-allow-origin"),
                    null,
                );
            },
        );
        await t.test(
            "all hosted libraries and their built scripts/styles are served locally",
            async () => {
                const loadedAssets = new Set();
                for (const [name, view] of Object.entries(browserViews)) {
                    const response = await fetch(`${base}${view.path}`);
                    assert.equal(response.status, 200, view.page);
                    assert.equal(
                        new URL(response.url).pathname,
                        `/library/${browserViews[getBrowserViewDestination(name)].page}`,
                    );
                    const html = await response.text();
                    assert.match(html, /<html/i);
                    for (const match of html.matchAll(
                        /<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g,
                    )) {
                        const assetUrl = new URL(match[1], response.url);
                        assert.equal(
                            assetUrl.origin,
                            base,
                            `Remote asset in ${view.page}`,
                        );
                        if (loadedAssets.has(assetUrl.href)) continue;
                        const asset = await fetch(assetUrl);
                        assert.equal(asset.status, 200, assetUrl.href);
                        loadedAssets.add(assetUrl.href);
                    }
                }
            },
        );
        await t.test("payload validation and errors are JSON", async () => {
            assert.equal(
                (await invoke({ method: "getHtml", params: {} })).status,
                400,
            );
            assert.equal(
                (
                    await invoke({
                        method: "memoryListCorpora",
                        params: { unexpected: true },
                    })
                ).status,
                400,
            );
            const malformed = await fetch(`${base}/api/views/invoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{",
            });
            assert.equal(malformed.status, 400);
            assert.equal((await malformed.json()).success, false);
            const failure = await invoke({
                method: "memoryCreateCorpus",
                params: { name: "broken" },
            });
            assert.equal(failure.status, 500);
            assert.deepEqual(await failure.json(), {
                success: false,
                error: "Domain failure",
            });
        });
        await t.test(
            "foreign, opaque, and other loopback origins cannot invoke",
            async () => {
                for (const origin of [
                    "https://example.com",
                    "null",
                    `http://localhost:${ready.port + 1}`,
                ]) {
                    assert.equal(
                        (
                            await invoke(
                                { method: "memoryListCorpora", params: {} },
                                { Origin: origin },
                            )
                        ).status,
                        403,
                    );
                }
                const rebindingStatus = await new Promise((resolve, reject) => {
                    const request = httpRequest(
                        `${base}/api/views/invoke`,
                        {
                            method: "POST",
                            headers: {
                                Host: "attacker.example",
                                "Content-Type": "application/json",
                            },
                        },
                        (response) => {
                            response.resume();
                            resolve(response.statusCode);
                        },
                    );
                    request.on("error", reject);
                    request.end(
                        JSON.stringify({
                            method: "memoryListCorpora",
                            params: {},
                        }),
                    );
                });
                assert.equal(rebindingStatus, 403);
                assert.equal(
                    (
                        await invoke(
                            { method: "memoryListCorpora", params: {} },
                            { "Sec-Fetch-Site": "cross-site" },
                        )
                    ).status,
                    403,
                );
            },
        );
        await t.test(
            "SSE receives parent progress without replacing other listeners",
            async () => {
                const response = await fetch(`${base}/api/views/events`, {
                    headers: { Origin: base },
                });
                assert.equal(response.status, 200);
                assert.equal(
                    response.headers.get("content-type"),
                    "text/event-stream; charset=utf-8",
                );
                const reader = response.body.getReader();
                try {
                    await reader.read();
                    rpc.send("viewEvent", {
                        type: "importProgress",
                        data: {
                            importId: "job-1",
                            phase: "processing",
                            current: 1,
                            total: 2,
                            message: "March\u2013April",
                        },
                        timestamp: new Date().toISOString(),
                    });
                    const event = new TextDecoder().decode(
                        (await reader.read()).value,
                    );
                    assert.match(event, /"type":"importProgress"/);
                    assert.match(event, /"importId":"job-1"/);
                    assert.match(event, /March\u2013April/);
                    const completed = await invoke({
                        method: "importWebsiteDataWithProgress",
                        params: {
                            importId: "job-1",
                            source: "test",
                            type: "history",
                        },
                    });
                    assert.deepEqual(await completed.json(), {
                        success: true,
                        data: { importId: "job-1", complete: true },
                    });
                } finally {
                    await reader.cancel();
                }
            },
        );
    },
);
