// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    buildWebviewHtml,
    createWebviewNonce,
} from "../webviewKit/webviewHtml.js";

test("createWebviewNonce returns distinct base64 nonces", () => {
    const a = createWebviewNonce();
    const b = createWebviewNonce();
    assert.match(a, /^[A-Za-z0-9+/=]+$/);
    assert.notEqual(a, b);
});

test("buildWebviewHtml emits a strict, nonce-locked CSP", () => {
    const html = buildWebviewHtml({
        nonce: "N0NCE",
        cspSource: "vscode-resource://x",
        scriptUri: "vscode-resource://x/impactReport.js",
        styleUri: "vscode-resource://x/impactReport.css",
        title: "Studio Impact Report",
    });

    // Locked down: nothing by default; scripts only via the nonce.
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-N0NCE'"));
    assert.ok(html.includes("base-uri 'none'"));
    assert.ok(html.includes("form-action 'none'"));
    // Styles from the webview origin or the nonce.
    assert.ok(html.includes("style-src vscode-resource://x 'nonce-N0NCE'"));
    // The script tag carries the nonce and the resolved bundle URI.
    assert.ok(
        html.includes(
            '<script nonce="N0NCE" src="vscode-resource://x/impactReport.js">',
        ),
    );
    // No inline script body (CSP would block it anyway).
    assert.ok(!/<script nonce="N0NCE">[^<]/.test(html));
});

test("buildWebviewHtml escapes the title", () => {
    const html = buildWebviewHtml({
        nonce: "N",
        cspSource: "x",
        scriptUri: "s",
        styleUri: "y",
        title: "<script>alert(1)</script>",
    });
    assert.ok(!html.includes("<title><script>"));
    assert.ok(html.includes("&lt;script&gt;"));
});
