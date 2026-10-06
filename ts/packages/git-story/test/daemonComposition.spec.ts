// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadDaemonDependencies } from "../src/daemonComposition.js";

let directory: string;
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "git-story-adapter-"));
});
afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
});

test("no adapter remains explicitly unconfigured", async () => {
    expect(await loadDaemonDependencies(undefined)).toBeUndefined();
});

test.each([
    'throw new Error("private-loader-content");',
    'export function createSessionWatcherDependencies() { throw new Error("private-factory-content"); }',
    "export async function createSessionWatcherDependencies() { return { privacyFilter: () => null }; }",
    'export function createSessionWatcherDependencies() { return { privacyFilter: () => null, approvedUpdateDestination: "wrong" }; }',
])("invalid trusted module fails without dependency text", async (module) => {
    const file = path.join(directory, "adapter.mjs");
    await fs.writeFile(file, module);
    await expect(loadDaemonDependencies(file)).rejects.toThrow(
        "Cannot load configured Session Watcher adapter",
    );
});

test("only intended functions cross composition boundary", async () => {
    const file = path.join(directory, "adapter.mjs");
    await fs.writeFile(
        file,
        `
        export async function createSessionWatcherDependencies() {
            return {
                privacyFilter: () => null,
                approvedUpdateDestination: () => {},
                onStatus: () => { throw new Error("must not override"); },
                capture: { stateDirectory: "must not override" },
            };
        }
    `,
    );
    const dependencies = await loadDaemonDependencies(file);
    expect(Object.keys(dependencies!)).toEqual([
        "privacyFilter",
        "approvedUpdateDestination",
    ]);
    expect(typeof dependencies!.privacyFilter).toBe("function");
    expect(typeof dependencies!.approvedUpdateDestination).toBe("function");
});

test("relative, directory and missing module paths are rejected", async () => {
    for (const file of [
        "relative.mjs",
        directory,
        path.join(directory, "missing.mjs"),
    ])
        await expect(loadDaemonDependencies(file)).rejects.toThrow(
            "Cannot load configured Session Watcher adapter",
        );
});
