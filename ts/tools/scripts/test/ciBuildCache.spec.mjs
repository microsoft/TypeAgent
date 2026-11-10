// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    cacheIdentity,
    createCache,
    restoreCache,
    stageCache,
    verifyCache,
} from "../ciBuildCache.mjs";
import { createManifest, stageArtifact, verifyManifest } from "../ciFanout.mjs";

const sha = "a".repeat(40);
const environment = { ImageOS: "test-image", ImageVersion: "1" };

test("cache and remainder commands reject a different checkout before reading or restoring artifacts", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-wrong-sha-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [script, command] of [
        ["ciBuildCache.mjs", "key"],
        ["ciWorkspaceLanes.mjs", "test"],
        ["ciPackagePartitions.mjs", "verify"],
    ]) {
        const result = spawnSync(
            process.execPath,
            [
                fileURLToPath(new URL(`../${script}`, import.meta.url)),
                command,
                "1",
            ],
            {
                env: { ...process.env, RUNNER_TEMP: root, GITHUB_SHA: sha },
                encoding: "utf8",
            },
        );
        assert.ifError(result.error);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Checkout does not match/);
    }
    assert.deepEqual(fs.readdirSync(root), []);
});

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-cache-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (name, value) => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, value);
    };
    write("package.json", JSON.stringify({ packageManager: "pnpm@11.9.0" }));
    write("pnpm-lock.yaml", "synthetic lock");
    write("packages/a/dist/index.js", "compiled");
    write("packages/a/dist/index.js.map", "diagnostics");
    write("packages/a/build.tsbuildinfo", "incremental");
    write(".npmrc", "synthetic configuration");
    write("node_modules/thirdparty/dist/index.js", "excluded dependency");
    return { root, write };
}

test("exact-source caches stage and restore coherent outputs and incremental state, never dependency folders", (t) => {
    const { root } = fixture(t);
    const directory = path.join(root, "cache");
    stageCache(root, directory, sha, environment);
    assert.equal(fs.existsSync(path.join(directory, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(directory, ".npmrc")), false);
    assert.equal(
        fs.existsSync(path.join(directory, "packages/a/dist/index.js.map")),
        true,
    );
    fs.rmSync(path.join(root, "packages/a"), { recursive: true });
    // Keep staging outside the source scanner, as actions/cache does on hosted runners.
    const transport = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-cache-transport-"),
    );
    t.after(() => fs.rmSync(transport, { recursive: true, force: true }));
    fs.renameSync(directory, path.join(transport, "payload"));
    restoreCache(root, path.join(transport, "payload"), sha, environment);
    assert.equal(
        fs.readFileSync(
            path.join(root, "packages/a/build.tsbuildinfo"),
            "utf8",
        ),
        "incremental",
    );
});

test("source, lockfile, compiler/build-tool and runner-image changes invalidate cache identity", (t) => {
    const { root, write } = fixture(t);
    const original = cacheIdentity(root, sha, environment);
    assert.notDeepEqual(
        cacheIdentity(root, "b".repeat(40), environment),
        original,
    );
    assert.notDeepEqual(
        cacheIdentity(root, sha, { ...environment, ImageVersion: "2" }),
        original,
    );
    assert.throws(() => cacheIdentity(root, sha, {}), /image identity/);
    write("pnpm-lock.yaml", "changed compiler, dependencies or generators");
    assert.notDeepEqual(cacheIdentity(root, sha, environment), original);
    const cache = createCache(root, sha, environment);
    cache.identity.abi = "wrong";
    assert.throws(() => verifyCache(root, sha, cache, environment), /identity/);
});

for (const missing of [
    "packages/a/dist/index.js",
    "packages/a/build.tsbuildinfo",
]) {
    test(`partial and corrupt cache entries fail visibly: ${missing}`, (t) => {
        const { root, write } = fixture(t);
        const cache = createCache(root, sha, environment);
        write(missing, "corruption");
        assert.throws(() => verifyCache(root, sha, cache, environment));
        fs.rmSync(path.join(root, missing));
        assert.throws(() => verifyCache(root, sha, cache, environment));
    });
}

test("consumer-scoped artifacts retain maps and every selected file, exclude only unneeded packages and build state", (t) => {
    const { root, write } = fixture(t);
    const spec = "packages/dispatcher/dispatcher/dist/test/example.spec.js";
    write(spec, "compiled spec");
    write(
        "packages/dispatcher/dispatcher/dist/test/example.spec.js.map",
        "diagnostics",
    );
    write(
        "packages/dispatcher/dispatcher/dist/tsconfig.tsbuildinfo",
        "not needed to execute tests",
    );
    const directories = ["packages/dispatcher/dispatcher", "packages/a"];
    const manifest = createManifest(root, sha, [spec], "packages", directories);
    assert.equal(manifest.files.length, 4);
    const transport = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-package-transport-"),
    );
    t.after(() => fs.rmSync(transport, { recursive: true, force: true }));
    const payload = path.join(transport, "payload");
    stageArtifact(root, manifest, payload);
    fs.copyFileSync(
        path.join(root, "pnpm-lock.yaml"),
        path.join(payload, "pnpm-lock.yaml"),
    );
    verifyManifest(payload, sha, manifest, "packages");
    const remainder = createManifest(root, sha, [], "remainder", directories);
    assert.equal(
        remainder.files.some((file) => file.path.endsWith(".tsbuildinfo")),
        true,
        "Whole-package tests may invoke the incremental compiler",
    );
    const remainderPayload = path.join(transport, "remainder");
    stageArtifact(root, remainder, remainderPayload);
    fs.copyFileSync(
        path.join(root, "pnpm-lock.yaml"),
        path.join(remainderPayload, "pnpm-lock.yaml"),
    );
    verifyManifest(remainderPayload, sha, remainder, "remainder");
    assert.throws(
        () => verifyManifest(payload, sha, manifest, "workspace"),
        /scope mismatch/,
    );
    write("packages/unrelated/dist/large-bundle.js", "unrelated");
    assert.throws(() => verifyManifest(root, sha, manifest, "packages"));
    fs.rmSync(path.join(payload, spec));
    assert.throws(
        () => verifyManifest(payload, sha, manifest, "packages"),
        /ENOENT/,
    );
    assert.throws(
        () => createManifest(root, sha, [spec], "packages", ["../outside"]),
        /Unsafe/,
    );
});
