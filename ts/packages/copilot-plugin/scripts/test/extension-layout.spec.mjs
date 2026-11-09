// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const pluginRoot = path.resolve(import.meta.dirname, "..", "..");

function extensionFixture(t, bundle) {
    const root = mkdtempSync(
        path.join(tmpdir(), "typeagent extension layout "),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manifest = JSON.parse(
        readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"),
    );
    const relativeEntry = path.join(
        manifest.extensions,
        "typeagent",
        "extension.mjs",
    );
    const entry = path.join(root, relativeEntry);
    mkdirSync(path.dirname(entry), { recursive: true });
    copyFileSync(path.join(pluginRoot, relativeEntry), entry);
    if (bundle !== undefined) {
        const builtEntry = path.join(
            root,
            "dist",
            "extensions",
            "typeagent",
            "extension.mjs",
        );
        mkdirSync(path.dirname(builtEntry), { recursive: true });
        writeFileSync(builtEntry, bundle);
    }
    return entry;
}

function runExtension(entry) {
    return spawnSync(process.execPath, [entry], {
        cwd: tmpdir(),
        encoding: "utf8",
        timeout: 10_000,
    });
}

test("source plugin manifest discovers and loads the bundled recorder once", (t) => {
    const entry = extensionFixture(
        t,
        'await Promise.resolve(); process.stdout.write("recorder loaded\\n");',
    );
    const result = runExtension(entry);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "recorder loaded\n");
});

test("source plugin reports a missing recorder bundle instead of starting silently", (t) => {
    const result = runExtension(extensionFixture(t));
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.equal(result.stdout, "");
});

test("source plugin propagates recorder startup failures", (t) => {
    const result = runExtension(
        extensionFixture(t, 'throw new Error("recorder startup failed");'),
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /recorder startup failed/);
    assert.equal(result.stdout, "");
});
