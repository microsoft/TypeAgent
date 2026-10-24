// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
const sha = (value) => createHash("sha256").update(value).digest("hex");

const checkpointRoots = [
    "packages\\memory\\service\\dist",
    "packages\\memory\\client\\dist",
    "packages\\memory\\conversation\\dist",
    "packages\\knowPro\\dist",
];

const requiredCheckpointFiles = [
    "indexedFragments.js",
    "informationalView.js",
    "fileMemoryService.js",
].map((name) => path.join("packages", "memory", "service", "dist", name));

export function checkpointExpectationHash(checkpoint) {
    return sha(JSON.stringify(checkpoint));
}

export function assertCheckpoint(actual, expected) {
    assert.ok(expected?.name && typeof expected.name === "string");
    assert.ok(expected.hashes && typeof expected.hashes === "object");
    for (const file of requiredCheckpointFiles)
        assert.match(expected.hashes[file] ?? "", /^[a-f0-9]{64}$/);
    for (const [file, hash] of Object.entries(expected.hashes)) {
        assert.match(hash, /^[a-f0-9]{64}$/);
        assert.equal(
            actual[file],
            hash,
            `Compiled checkpoint mismatch: ${file}`,
        );
    }
}

export async function snapshotCompiledCheckpoint(productRoot) {
    const hashes = {};
    const visit = async (relative) => {
        for (const entry of await readdir(path.join(productRoot, relative), {
            withFileTypes: true,
        })) {
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else if (entry.name.endsWith(".js"))
                hashes[next] = sha(
                    await readFile(path.join(productRoot, next)),
                );
        }
    };
    for (const root of checkpointRoots) await visit(root);
    return hashes;
}

export async function writeJson(file, value) {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, file);
}
