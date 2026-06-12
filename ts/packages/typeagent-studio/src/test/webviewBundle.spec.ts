// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const bundlePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "dist",
    "webview",
    "impactReport.js",
);

// The webview client bundle is produced by `pnpm build` (esbuild browser
// target). Skip gracefully if tests run before a build.
const hasBundle = existsSync(bundlePath);

test("webview bundle excludes node/vscode/ws (browser-safe)", { skip: !hasBundle }, () => {
    const src = readFileSync(bundlePath, "utf8");
    // No CommonJS requires of node/host-only modules leaking into the iframe.
    assert.ok(!/require\(["']ws["']\)/.test(src), "must not bundle ws");
    assert.ok(!/require\(["']vscode["']\)/.test(src), "must not bundle vscode");
    assert.ok(
        !/require\(["']node:/.test(src),
        "must not bundle node: built-ins",
    );
    assert.ok(
        !/require\(["'](?:crypto|fs|os|path|net|http)["']\)/.test(src),
        "must not bundle bare node built-ins",
    );
});
