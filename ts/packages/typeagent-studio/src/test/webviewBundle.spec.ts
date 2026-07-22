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

const traceViewerBundlePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "dist",
    "webview",
    "traceViewer.js",
);

// The webview client bundle is produced by `pnpm build` (esbuild browser
// target). Skip gracefully if tests run before a build.
const hasBundle = existsSync(bundlePath);

function assertBrowserSafe(src: string): void {
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
}

test(
    "webview bundle excludes node/vscode/ws (browser-safe)",
    { skip: !hasBundle },
    () => {
        assertBrowserSafe(readFileSync(bundlePath, "utf8"));
    },
);

test(
    "trace viewer bundle excludes node/vscode/ws (browser-safe)",
    { skip: !existsSync(traceViewerBundlePath) },
    () => {
        assertBrowserSafe(readFileSync(traceViewerBundlePath, "utf8"));
    },
);

// The static-grammar replay resolver compiles grammars that use built-in
// entities (Ordinal/Cardinal), which reads `builtInEntities.agr` from disk next
// to the bundle. esbuild copies it into `dist/`; without it the service throws
// ENOENT at replay time. Guard the copy step so packaging can't silently regress.
const builtInEntitiesAsset = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "dist",
    "builtInEntities.agr",
);

test(
    "build copies builtInEntities.agr next to the bundles",
    { skip: !hasBundle },
    () => {
        assert.ok(
            existsSync(builtInEntitiesAsset),
            "dist/builtInEntities.agr must ship for static-grammar replay",
        );
        const text = readFileSync(builtInEntitiesAsset, "utf8");
        assert.ok(
            text.length > 0,
            "built-in entities grammar must be non-empty",
        );
    },
);
