// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredTopicGenerator } from "../../packages/memory/service/dist/topicGeneration.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashBytes, hashWorkingTreePatch } from "./replay-artifacts.mjs";

test("working-tree identity streams patches larger than the subprocess default buffer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "topic-patch-identity-"));
    try {
        const git = (...args) =>
            execFileSync("git", ["--no-pager", ...args], {
                cwd: root,
                maxBuffer: 8 * 1024 * 1024,
            });
        git("init", "--quiet");
        git("config", "core.autocrlf", "false");
        await writeFile(path.join(root, "fixture.txt"), "initial\n");
        git("add", "fixture.txt");
        git(
            "-c",
            "user.name=Replay test",
            "-c",
            "user.email=replay@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        );
        await writeFile(
            path.join(root, "fixture.txt"),
            Array.from(
                { length: 100000 },
                (_, i) => `source-free synthetic fixture ${i}\n`,
            ).join(""),
        );
        const reference = git("diff", "--binary", "HEAD");
        assert.ok(reference.byteLength > 1024 * 1024);
        assert.equal(await hashWorkingTreePatch(root), hashBytes(reference));
        await assert.rejects(hashWorkingTreePatch(path.join(root, "missing")));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("JavaScript callers reject obsolete positional arguments before model or engine initialization", () => {
    let calls = 0;
    const model = {
        completionSettings: {},
        complete() {
            calls++;
            throw new Error("Model must not run");
        },
    };
    const factory = () => {
        calls++;
        throw new Error("Factory must not run");
    };
    for (const args of [
        [undefined, model],
        ["endpoint", model, true, { concurrency: 2 }],
        [undefined, model, true, factory],
        [undefined, model, true, undefined, { concurrency: 2 }],
        ["endpoint"],
        [factory],
        [{ concurrency: 2 }],
    ])
        assert.throws(
            () =>
                Reflect.apply(createConfiguredTopicGenerator, undefined, args),
            /named options/,
        );
    assert.equal(calls, 0);
    for (const mode of [
        { kind: "raw" },
        { kind: "generative", settings: { concurrency: 2 } },
        { kind: "decision", createOptions: factory },
    ])
        assert.equal(
            typeof createConfiguredTopicGenerator({
                endpoint: "offline",
                model,
                mode,
            }),
            "function",
        );
    assert.equal(typeof createConfiguredTopicGenerator(), "function");
    assert.equal(calls, 0);
});

test("named mode validation rejects mixed or malformed settings without silently selecting an engine", () => {
    for (const options of [
        null,
        [],
        { model: null },
        { endpoint: 42 },
        { mode: null },
        { mode: {} },
        { mode: { kind: "other" } },
        { mode: { kind: "raw", settings: {} } },
        { mode: { kind: "generative", createOptions: () => {} } },
        { mode: { kind: "generative", settings: null } },
        { mode: { kind: "generative", settings: { unknown: true } } },
        { mode: { kind: "generative", settings: { concurrency: 24 } } },
        { mode: { kind: "decision" } },
        { mode: { kind: "decision", createOptions: true } },
        { mode: { kind: "decision", createOptions: () => {}, settings: {} } },
    ])
        assert.throws(() => createConfiguredTopicGenerator(options));
});
