// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { browserViews } from "@typeagent/browser-control-rpc/viewRoutes";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";

test("view validation rejects generic operations and malformed domain payloads", () => {
    for (const body of [
        { method: "openTab", params: { url: "https://example.com" } },
        { method: "toString", params: {} },
        { method: "memoryGetCorpus", params: {} },
        { method: "deleteWebFlow", params: { name: 123 } },
        { method: "getAllWebFlows", params: { url: "https://example.com" } },
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
            "canonical and legacy view routes redirect without dropping the query",
            async () => {
                for (const route of [
                    "/knowledge/",
                    "/views/knowledgeLibrary.html",
                    "/knowledgeLibrary.html",
                ]) {
                    const response = await fetch(
                        `${base}${route}?topic=one%20two`,
                        { redirect: "manual" },
                    );
                    assert.equal(response.status, 302);
                    assert.equal(
                        response.headers.get("location"),
                        "/library/knowledgeLibrary.html?topic=one%20two",
                    );
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
            "all six libraries and their built scripts/styles are served locally",
            async () => {
                for (const view of Object.values(browserViews)) {
                    const response = await fetch(`${base}${view.path}`);
                    assert.equal(response.status, 200, view.page);
                    assert.equal(
                        new URL(response.url).pathname,
                        `/library/${view.page}`,
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
                        const asset = await fetch(assetUrl);
                        assert.equal(asset.status, 200, assetUrl.href);
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
