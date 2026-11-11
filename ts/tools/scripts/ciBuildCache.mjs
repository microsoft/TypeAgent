// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createManifest,
    verifyManifest,
    identity,
    verifyCheckout,
} from "./ciFanout.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const cacheName = "ci-build-cache.json";

export function cacheIdentity(root, sha, environment = process.env) {
    assert.ok(
        environment.ImageOS && environment.ImageVersion,
        "Hosted runner image identity is required for build caching",
    );
    return {
        ...identity(root, sha),
        image: environment.ImageOS,
        imageVersion: environment.ImageVersion,
        packageManager: JSON.parse(
            fs.readFileSync(path.join(root, "package.json"), "utf8"),
        ).packageManager,
    };
}

function incrementalFiles(root, relative = "") {
    const files = [];
    for (const entry of fs.readdirSync(path.join(root, relative), {
        withFileTypes: true,
    })) {
        if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
        const name = path.join(relative, entry.name);
        assert.ok(
            !entry.isSymbolicLink() || !entry.name.endsWith(".tsbuildinfo"),
            "Symlink in incremental metadata",
        );
        if (entry.isDirectory()) files.push(...incrementalFiles(root, name));
        else if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
            const portable = name.split(path.sep).join("/");
            assert.ok(
                !portable
                    .split("/")
                    .some((part) => [".", ".."].includes(part)) &&
                    !/[\\:]/.test(portable),
            );
            const bytes = fs.readFileSync(path.join(root, name));
            files.push({
                path: portable,
                size: bytes.length,
                sha256: digest(bytes),
            });
        }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function createCache(root, sha, environment) {
    const manifest = createManifest(root, sha, [], "workspace");
    return {
        version: 1,
        identity: cacheIdentity(root, sha, environment),
        manifest,
        incremental: incrementalFiles(root),
    };
}

export function verifyCache(root, sha, cache, environment) {
    assert.equal(cache.version, 1, "Unknown cache format");
    assert.deepEqual(
        cache.identity,
        cacheIdentity(root, sha, environment),
        "Build cache identity mismatch",
    );
    verifyManifest(root, sha, cache.manifest, "workspace");
    assert.deepEqual(
        incrementalFiles(root),
        cache.incremental,
        "Missing, corrupt or unexpected incremental metadata",
    );
}

export function stageCache(root, directory, sha, environment) {
    assert.ok(
        !fs.existsSync(directory),
        "Build cache staging directory must be new",
    );
    const cache = createCache(root, sha, environment);
    fs.mkdirSync(directory, { recursive: true });
    for (const file of [...cache.manifest.files, ...cache.incremental]) {
        const destination = path.join(directory, file.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file.path), destination);
    }
    for (const file of ["package.json", "pnpm-lock.yaml"]) {
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    fs.writeFileSync(
        path.join(directory, cacheName),
        JSON.stringify(cache, null, 2),
    );
    verifyCache(directory, sha, cache, environment);
}

export function restoreCache(root, directory, sha, environment) {
    const cache = JSON.parse(
        fs.readFileSync(path.join(directory, cacheName), "utf8"),
    );
    assert.deepEqual(
        cache.identity,
        cacheIdentity(root, sha, environment),
        "Build cache identity mismatch",
    );
    verifyCache(directory, sha, cache, environment);
    for (const file of [...cache.manifest.files, ...cache.incremental]) {
        const destination = path.join(root, file.path);
        const relative = path.relative(root, destination);
        for (
            let parent = path.dirname(destination);
            parent !== root;
            parent = path.dirname(parent)
        ) {
            assert.ok(
                parent.startsWith(`${root}${path.sep}`),
                "Cache destination outside workspace",
            );
            if (fs.existsSync(parent))
                assert.ok(
                    !fs.lstatSync(parent).isSymbolicLink(),
                    "Symlink in cache destination",
                );
        }
        assert.ok(relative && !relative.startsWith(".."));
        if (fs.existsSync(destination))
            assert.ok(
                !fs.lstatSync(destination).isSymbolicLink(),
                "Symlink in cache destination",
            );
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(directory, file.path), destination);
    }
    verifyCache(root, sha, cache, environment);
}

function main() {
    const root = process.cwd();
    const sha = process.env.GITHUB_SHA;
    verifyCheckout(root, sha);
    assert.ok(process.env.RUNNER_TEMP);
    const directory = path.join(process.env.RUNNER_TEMP, "fanout-build-cache");
    switch (process.argv[2]) {
        case "key": {
            const key = `fanout-build-v1-${digest(JSON.stringify(cacheIdentity(root, sha)))}`;
            assert.ok(process.env.GITHUB_OUTPUT);
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`);
            break;
        }
        case "create":
            stageCache(root, directory, sha);
            break;
        case "restore":
            restoreCache(root, directory, sha);
            console.log(
                "Exact-source build cache integrity verified; the normal build must still run.",
            );
            break;
        default:
            throw new Error("Expected build cache key, create or verify");
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    main();
