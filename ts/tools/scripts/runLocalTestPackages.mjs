// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const macosCompatibilitySuites = [
    {
        directory: "packages/config",
        files: ["fileLink"],
    },
    {
        directory: "packages/memory/storage",
        files: ["sqliteCollection", "sqliteDataFrame"],
    },
    {
        directory: "packages/memory/service",
        files: [
            "corpusAccess",
            "filesystemPublication",
            "markdownPersistence",
            "revisionTextStore",
            "viewHistoryRecords",
        ],
    },
    {
        directory: "packages/dispatcher/dispatcher",
        files: ["instanceLock", "sessionContext", "codingSessionLifecycle"],
    },
    {
        directory: "packages/defaultAgentProvider",
        files: [
            "constructionCacheRoundTrip1",
            "constructionCacheRoundTripMerge1",
        ],
    },
];

export function localTestCommands(profile, root) {
    if (profile === "full") {
        return [
            {
                cwd: root,
                args: [
                    "-r",
                    "--no-bail",
                    "--no-sort",
                    "--stream",
                    "--workspace-concurrency=3",
                    "run",
                    "test:local",
                ],
            },
        ];
    }
    if (profile !== "macos-compat") {
        throw new Error(`Unknown TYPEAGENT_TEST_PROFILE: ${profile}`);
    }
    return macosCompatibilitySuites.map(({ directory, files }) => ({
        cwd: path.resolve(root, directory),
        args: [
            "run",
            "jest-esm",
            "--runTestsByPath",
            ...files.map((file) =>
                path.resolve(
                    root,
                    directory,
                    "dist",
                    "test",
                    `${file}.spec.js`,
                ),
            ),
        ],
    }));
}

export function runLocalTestPackages({
    profile,
    root,
    pnpmPath,
    run = spawnSync,
}) {
    const commands = localTestCommands(profile, root);
    if (!pnpmPath || !fs.existsSync(pnpmPath)) {
        throw new Error("Run local package tests through pnpm run.");
    }
    if (profile === "macos-compat") {
        for (const { args } of commands) {
            for (const file of args.slice(3)) {
                if (!fs.statSync(file).isFile()) {
                    throw new Error(
                        `Missing compiled compatibility suite: ${file}`,
                    );
                }
            }
        }
    }
    let status = 0;
    console.error(`Local package test profile: ${profile}`);
    for (const { cwd, args } of commands) {
        console.error(`Testing ${cwd}: ${args.join(" ")}`);
        const result = run(process.execPath, [pnpmPath, ...args], {
            cwd,
            env: process.env,
            stdio: "inherit",
        });
        if (result.error) throw result.error;
        if (result.signal) {
            process.kill(process.pid, result.signal);
            return 1;
        }
        if (result.status !== 0) status = 1;
    }
    return status;
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    process.exitCode = runLocalTestPackages({
        profile: process.env.TYPEAGENT_TEST_PROFILE ?? "full",
        root: process.cwd(),
        pnpmPath: process.env.npm_execpath,
    });
}
