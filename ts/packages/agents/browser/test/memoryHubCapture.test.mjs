// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryHubCaptureFunctions } from "../dist/agent/memoryHubCapture.mjs";
import { createExtractionInputsFromFragments } from "../dist/agent/knowledge/actions/extractionInputs.mjs";

const url = "https://example.invalid/guide";
const page = { pageId: "tab:12", url, title: "Actual page title" };
const view = "http://localhost:62765/memory/hub/";
const text =
    "Check the worker carefully before restarting. Keep the worker paused until the review is complete.";

test("shared normalization preserves frame metadata, timestamps and readable-content rules", () => {
    const timestamp = "2026-10-02T00:00:00.000Z";
    const inputs = createExtractionInputsFromFragments(
        [
            {
                frameId: 0,
                content: `<script>NEVER INDEX SCRIPT</script><style>NEVER INDEX STYLE</style><p>${text}</p>`,
            },
            { frameId: 2, text },
            { content: "Short" },
        ],
        url,
        page.title,
        "index",
        timestamp,
    );
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].textContent, text);
    assert.deepEqual(
        inputs.map((input) => input.metadata),
        [
            { frameId: 0, isIframe: false },
            { frameId: 2, isIframe: true },
        ],
    );
    assert.ok(
        inputs.every(
            (input) =>
                input.timestamp === timestamp && input.source === "index",
        ),
    );
    assert.equal(inputs[1].url, `${url}#iframe-2`);
});

function fixture() {
    const calls = [];
    const snapshot = {
        ...page,
        htmlFragments: [{ frameId: "0", content: `<p>${text}</p>` }],
        warnings: ["Embedded frames omitted"],
    };
    const browser = {
        getCapturePages: async () => [
            page,
            { pageId: "tab:99", url: view, title: "Memory" },
        ],
        capturePageSnapshot: async (pageId) => {
            calls.push(["snapshot", pageId]);
            return snapshot;
        },
        getPageUrl: async () => {
            throw new Error("Unsafe active-page reads must not run");
        },
        getHtmlFragments: async () => {
            throw new Error("Unsafe active-page reads must not run");
        },
    };
    const memory = {
        ingest: async (...args) => {
            calls.push(["ingest", ...args]);
            return {
                source: { corpusId: "browser", sourceId: "saved" },
                warnings: ["Extraction warning"],
            };
        },
    };
    return {
        browser,
        memory,
        snapshot,
        calls,
        capture: createMemoryHubCaptureFunctions(
            () => browser,
            () => memory,
            () => 62765,
        ),
    };
}

test("page picker excludes own views but permits other loopback applications", async () => {
    const { capture, browser } = fixture();
    browser.getCapturePages = async () => [
        page,
        { pageId: "hub", url: view, title: "Memory" },
        {
            pageId: "own-ipv6",
            url: "http://[::1]:62765/browser/memoryHub.html",
            title: "Memory",
        },
        {
            pageId: "other",
            url: "http://localhost:8080/docs",
            title: "Local docs",
        },
        { pageId: "blank", url: "about:blank", title: "Blank" },
    ];
    assert.deepEqual(
        (await capture.memoryHubCapturePages({})).pages.map((p) => p.pageId),
        ["tab:12", "other"],
    );
});

test("explicit snapshot uses one selected page and canonical browser ingestion", async () => {
    const { capture, calls } = fixture();
    const result = await capture.memoryHubCapturePage({
        pageId: page.pageId,
        expectedUrl: url,
    });
    assert.deepEqual(result, {
        corpusId: "browser",
        sourceId: "saved",
        warnings: ["Embedded frames omitted", "Extraction warning"],
    });
    assert.deepEqual(calls[0], ["snapshot", page.pageId]);
    const [, document, mode, options] = calls[1];
    assert.equal(document.url, url);
    assert.equal(document.title, page.title);
    assert.ok(document.markdown.includes(text));
    assert.equal(document.source, "current-page");
    assert.equal(document.activityType, "captured");
    assert.ok(Number.isFinite(Date.parse(document.capturedAt)));
    assert.equal(mode, "content");
    assert.equal(options.reportHowToStatus, true);
});

test("changed, mismatched and own-view snapshots cannot reach ingestion", async () => {
    for (const patch of [
        { url: "https://example.invalid/different" },
        { pageId: "tab:other" },
        { url: view },
        { htmlFragments: [{ frameId: "unknown", content: text }] },
    ]) {
        const { capture, snapshot, calls } = fixture();
        Object.assign(snapshot, patch);
        await assert.rejects(
            capture.memoryHubCapturePage({
                pageId: page.pageId,
                expectedUrl: url,
            }),
            /changed|frame identity/,
        );
        assert.ok(calls.every(([kind]) => kind !== "ingest"));
    }
});

test("unsupported controls, absent memory and prohibited URLs fail explicitly", async () => {
    const missing = createMemoryHubCaptureFunctions(
        () => ({}),
        () => ({ ingest() {} }),
        () => 62765,
    );
    await assert.rejects(
        missing.memoryHubCapturePages({}),
        /does not support explicit-page capture/,
    );
    const noMemory = createMemoryHubCaptureFunctions(
        () => fixture().browser,
        () => undefined,
        () => 62765,
    );
    await assert.rejects(
        noMemory.memoryHubCapturePages({}),
        /Durable browser memory is not available/,
    );
    const { capture, calls } = fixture();
    for (const expectedUrl of [
        view,
        "file:///C:/private",
        "javascript:alert(1)",
    ])
        await assert.rejects(
            capture.memoryHubCapturePage({ pageId: page.pageId, expectedUrl }),
            /outside the local Memory view/,
        );
    assert.equal(calls.length, 0);
});

test("empty, vanished pages and ingestion errors never report successful capture", async () => {
    const { capture, snapshot, browser, memory, calls } = fixture();
    snapshot.htmlFragments = [];
    await assert.rejects(
        capture.memoryHubCapturePage({ pageId: page.pageId, expectedUrl: url }),
        /no readable content/,
    );
    browser.capturePageSnapshot = async () => {
        throw new Error("Selected tab disappeared");
    };
    await assert.rejects(
        capture.memoryHubCapturePage({ pageId: page.pageId, expectedUrl: url }),
        /disappeared/,
    );
    assert.ok(calls.every(([kind]) => kind !== "ingest"));
    browser.capturePageSnapshot = async () => ({
        ...snapshot,
        htmlFragments: [{ frameId: "0", content: text }],
    });
    memory.ingest = async () => {
        throw new Error("Memory ingest failed");
    };
    await assert.rejects(
        capture.memoryHubCapturePage({ pageId: page.pageId, expectedUrl: url }),
        /Memory ingest failed/,
    );
});
