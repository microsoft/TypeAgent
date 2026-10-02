// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    browserViews,
    getBrowserViewDestination,
} from "@typeagent/browser-control-rpc/viewRoutes";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";

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
        const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
            "base64",
        );
        const hash = createHash("sha256").update(png).digest("hex");
        const runbookCalls = [];
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
                procedures: [],
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
            memoryHubRunbooks: async (params) => {
                runbookCalls.push(["list", params]);
                return {
                    items: [],
                    total: 0,
                    errors: [],
                    warnings: ["Catalog fixture"],
                };
            },
            memoryHubSkillAction: async (params) => {
                runbookCalls.push(["skill", params]);
                return {
                    identity: params.identity,
                    revisionId: params.revisionId,
                    state: "validated",
                    active: false,
                };
            },
            memoryHubReadRunbookAsset: async (params) => {
                if (
                    params.variant !== "original" ||
                    params.acknowledgeUnreviewed !== true
                )
                    throw new Error(
                        "Original pixels require explicit acknowledgement; safe preview unavailable",
                    );
                if (params.hash !== hash)
                    throw new Error("Asset hash mismatch");
                return {
                    asset: { mimeType: "image/png", size: png.length, hash },
                    data: png.toString("base64"),
                };
            },
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
            "Runbook listing and exact guarded lifecycle cross HTTP and parent IPC",
            async () => {
                const list = await invoke({
                    method: "memoryHubRunbooks",
                    params: { corpusId: "c", needsReview: true, pageSize: 25 },
                });
                assert.equal(list.status, 200);
                assert.equal(
                    (await list.json()).data.warnings[0],
                    "Catalog fixture",
                );
                const mutation = {
                    identity: {
                        scope: "user",
                        origin: "fixture",
                        name: "worker",
                    },
                    revisionId: "exact-revision",
                    expectedState: "draft",
                    expectedActive: false,
                    action: "validate",
                };
                const response = await invoke({
                    method: "memoryHubSkillAction",
                    params: mutation,
                });
                assert.equal(response.status, 200);
                assert.deepEqual(runbookCalls[1], ["skill", mutation]);
                const rejected = await invoke({
                    method: "memoryHubSkillAction",
                    params: { ...mutation, expectedActive: undefined },
                });
                assert.equal(rejected.status, 400);
                assert.equal(runbookCalls.length, 2);
            },
        );
        await t.test(
            "Controlled revision assets are acknowledged, immutable and never safe-preview fallbacks",
            async () => {
                const query = new URLSearchParams({
                    corpusId: "c",
                    sourceId: "s",
                    revisionId: "r",
                    assetId: "a",
                    hash,
                    variant: "original",
                });
                let response = await fetch(
                    `${base}/api/views/runbook-asset?${query}`,
                );
                assert.equal(response.status, 500);
                assert.match((await response.json()).error, /acknowledgement/);
                query.set("acknowledgeUnreviewed", "true");
                response = await fetch(
                    `${base}/api/views/runbook-asset?${query}`,
                );
                assert.equal(response.status, 200);
                assert.equal(response.headers.get("content-type"), "image/png");
                assert.equal(response.headers.get("cache-control"), "no-store");
                assert.equal(
                    response.headers.get("cross-origin-resource-policy"),
                    "same-origin",
                );
                assert.equal(
                    response.headers.get("x-content-type-options"),
                    "nosniff",
                );
                assert.match(
                    response.headers.get("content-security-policy"),
                    /sandbox/,
                );
                assert.deepEqual(
                    Buffer.from(await response.arrayBuffer()),
                    png,
                );
                query.set("variant", "preview");
                response = await fetch(
                    `${base}/api/views/runbook-asset?${query}`,
                );
                assert.equal(response.status, 500);
                assert.match(
                    (await response.json()).error,
                    /safe preview unavailable/,
                );
                query.set("hash", "bad");
                response = await fetch(
                    `${base}/api/views/runbook-asset?${query}`,
                );
                assert.equal(response.status, 400);
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
                        procedures: [],
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
