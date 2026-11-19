// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { createServer } from "vite";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";

const request = {
    corpusId: "corpus",
    reviewId: "review",
    expectedVersion: 3,
    action: "keep_separate",
};

test("review methods are routed and validated before the browser service boundary", async () => {
    for (const method of [
        "memoryListWikiAmbiguityReviews",
        "memoryResolveWikiAmbiguityReview",
    ])
        assert.ok(viewMethods.includes(method), `${method} must cross IPC`);
    const calls = [];
    const functions = createMemoryViewFunctions(() => ({
        listWikiAmbiguityReviews: async (corpusId) => {
            calls.push(corpusId);
            return [];
        },
        resolveWikiAmbiguityReview: async (input) => {
            calls.push(input);
            return { state: "resolved" };
        },
    }));
    assert.deepEqual(
        validateViewRequest({
            method: "memoryResolveWikiAmbiguityReview",
            params: request,
        }).params,
        request,
    );
    assert.deepEqual(
        await functions.memoryListWikiAmbiguityReviews({
            corpusId: "corpus",
        }),
        [],
    );
    await functions.memoryResolveWikiAmbiguityReview(request);
    for (const invalid of [
        { ...request, expectedVersion: undefined },
        { ...request, action: "publish" },
        { ...request, actor: "memory-view-generator" },
    ])
        assert.throws(() =>
            validateViewRequest({
                method: "memoryResolveWikiAmbiguityReview",
                params: invalid,
            }),
        );
    assert.throws(() =>
        functions.memoryResolveWikiAmbiguityReview({
            ...request,
            expectedVersion: 0,
        }),
    );
    assert.deepEqual(calls, ["corpus", request]);
});

test(
    "real Chromium Inbox preview submits all guarded actions and distinguishes stale and refresh failures",
    { timeout: 60000 },
    async () => {
        const configured = process.env.TYPEAGENT_BROWSER_EXECUTABLE;
        const executablePath = configured
            ? configured
            : [
                  await puppeteer.executablePath(),
                  ...[
                      process.env.ProgramFiles,
                      process.env["ProgramFiles(x86)"],
                  ]
                      .filter(Boolean)
                      .map((root) =>
                          path.join(
                              root,
                              "Microsoft",
                              "Edge",
                              "Application",
                              "msedge.exe",
                          ),
                      ),
              ].find((candidate) => existsSync(candidate));
        assert.ok(
            executablePath && existsSync(executablePath),
            "A local Chromium executable is required; set TYPEAGENT_BROWSER_EXECUTABLE",
        );
        const server = await createServer({
            configFile: false,
            root: fileURLToPath(new URL("..", import.meta.url)),
            optimizeDeps: { noDiscovery: true },
            server: { host: "127.0.0.1", port: 0 },
            plugins: [
                {
                    name: "synthetic-wiki-review-fixture",
                    configureServer(vite) {
                        vite.middlewares.use((req, res, next) => {
                            if (req.url !== "/wiki-review-fixture")
                                return next();
                            res.setHeader("Content-Type", "text/html");
                            res.end(
                                "<!doctype html><title>Synthetic Wiki review fixture</title><main></main>",
                            );
                        });
                    },
                },
            ],
        });
        let browser;
        try {
            await server.listen();
            const address = server.httpServer.address();
            assert.ok(address && typeof address !== "string");
            browser = await puppeteer.launch({
                executablePath,
                headless: true,
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 900 });
            await page.goto(
                `http://127.0.0.1:${address.port}/wiki-review-fixture`,
            );
            const result = await page.evaluate(async () => {
                const { wikiAmbiguityAttention } = await import(
                    "/src/views/client/library/memoryHubWikiAmbiguity.ts"
                );
                const requests = [];
                const review = {
                    id: "review",
                    corpusId: "corpus",
                    version: 3,
                    state: "needsReview",
                    reason: "Synthetic only: independent purposes",
                    assessment: { disposition: "ambiguous" },
                    participants: [
                        {
                            id: "candidate",
                            revisionId: null,
                            input: {
                                inputs: [
                                    {
                                        content:
                                            "Synthetic original evidence: keep the safety qualification.",
                                    },
                                ],
                            },
                        },
                    ],
                    request: {
                        model: "GPT_6_1_SOL",
                        logicalRequests: 1,
                        state: "returned",
                        transportRetries: 0,
                    },
                    resolution: {
                        status: "resolved",
                        reason: "Retain independent subjects",
                        groups: [
                            {
                                action: "keep_separate",
                                ids: ["candidate"],
                                survivorId: null,
                                combined: null,
                                sections: [],
                            },
                        ],
                    },
                };
                const messages = [];
                for (const action of ["keep_separate", "approve", "edit"]) {
                    const card = wikiAmbiguityAttention(
                        review,
                        async (input) => {
                            requests.push(input);
                            if (action === "approve")
                                throw new Error("Relevant revision changed");
                            return { ...review, state: "resolved" };
                        },
                        async () => {
                            if (action === "edit")
                                throw new Error("Inbox RPC unavailable");
                        },
                    );
                    document.querySelector("main").replaceChildren(card.detail);
                    const label = {
                        keep_separate: "Keep separate",
                        approve: "Approve verified combination",
                        edit: "Revalidate edited proposal",
                    }[action];
                    [...card.detail.querySelectorAll("button")]
                        .find((button) => button.textContent === label)
                        .click();
                    await new Promise((done) => setTimeout(done, 0));
                    messages.push(card.detail.textContent);
                }
                return { requests, messages };
            });
            assert.deepEqual(
                result.requests.map(({ action }) => action),
                ["keep_separate", "approve", "edit"],
            );
            for (const input of result.requests) {
                assert.equal(input.expectedVersion, 3);
                assert.equal(input.corpusId, "corpus");
                assert.equal(input.reviewId, "review");
            }
            assert.equal(
                result.requests[2].resolution.reason,
                "Retain independent subjects",
            );
            assert.match(
                result.messages[0],
                /Synthetic original evidence: keep the safety qualification/,
            );
            assert.match(
                result.messages[1],
                /Review request failed: Relevant revision changed/,
            );
            assert.match(
                result.messages[2],
                /Review returned resolved, but Inbox refresh failed: Inbox RPC unavailable/,
            );
        } finally {
            await browser?.close();
            await server.close();
        }
    },
);
