// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserControlRpcFacade } from "@typeagent/browser-control-rpc/types";
import { createExternalBrowserClient } from "../dist/agent/rpc/externalBrowserControlClient.mjs";

test("capture facade preserves receivers and transports coherent snapshots", async () => {
    const page = {
        pageId: "opaque",
        url: "https://example.com",
        title: "Article",
    };
    const snapshot = {
        ...page,
        htmlFragments: [{ frameId: "0", content: "<h1>Article</h1>" }],
        warnings: [],
    };
    const control = Object.create({
        async getCapturePages() {
            return [this.page];
        },
        async capturePageSnapshot(pageId) {
            assert.equal(pageId, this.page.pageId);
            return this.snapshot;
        },
    });
    Object.assign(control, { page, snapshot });
    const facade = createBrowserControlRpcFacade(control);
    assert.deepEqual(await facade.getCapturePages(), [page]);
    assert.deepEqual(await facade.capturePageSnapshot("opaque"), snapshot);
});

test("legacy unsupported facade explicitly rejects without active-tab reads", async () => {
    const control = {
        getPageUrl() {
            assert.fail("Unsafe active-tab URL fallback");
        },
        getHtmlFragments() {
            assert.fail("Unsafe active-tab HTML fallback");
        },
    };
    const facade = createBrowserControlRpcFacade(control);
    await assert.rejects(facade.getCapturePages(), /capture is unavailable/);
    await assert.rejects(
        facade.capturePageSnapshot("opaque"),
        /capture is unavailable/,
    );
});

test("external client uses dedicated capture RPC and explicitly rejects old providers", async () => {
    const calls = [];
    const rpc = {
        async invoke(method, ...args) {
            calls.push([method, ...args]);
            if (method === "getCapturePages") return [];
            throw new Error(`No invoke handler ${method}`);
        },
    };
    const server = { getActiveClient: () => ({ browserControlRpc: rpc }) };
    const { control } = createExternalBrowserClient(server, "session");
    assert.deepEqual(await control.getCapturePages(), []);
    await assert.rejects(
        control.capturePageSnapshot("opaque"),
        /capture is unavailable/,
    );
    assert.deepEqual(calls, [
        ["getCapturePages"],
        ["capturePageSnapshot", "opaque"],
    ]);
});
