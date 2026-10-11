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
        assert.throws(() => validateViewRequest(body));
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
                        },
                        timestamp: new Date().toISOString(),
                    });
                    const event = new TextDecoder().decode(
                        (await reader.read()).value,
                    );
                    assert.match(event, /"type":"importProgress"/);
                    assert.match(event, /"importId":"job-1"/);
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
