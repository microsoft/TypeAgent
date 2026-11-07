// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { partitionPackages } from "./lib/ciTestPartitions.mjs";

export function spawnPnpm(args, options, run = spawnSync) {
    const pnpmPath = process.env.npm_execpath;
    if (!pnpmPath || !/^pnpm\.(?:mjs|cjs|js)$/i.test(path.basename(pnpmPath))) {
        throw new Error(
            "The CI runner requires pnpm's JavaScript CLI; use pnpm run ci:node.",
        );
    }
    if (!fs.statSync(pnpmPath).isFile()) {
        throw new Error("The pnpm JavaScript CLI must be a file.");
    }
    return run(process.execPath, [pnpmPath, ...args], {
        ...options,
        shell: false,
    });
}

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

function laneCommand(root, workspaceConcurrency, packages) {
    const excluded = [
        "@typeagent/memory-service",
        ...Object.values(partitionPackages).map(({ name }) => name),
    ];
    if (
        !Array.isArray(packages) ||
        packages.length === 0 ||
        new Set(packages).size !== packages.length ||
        packages.some(
            (name) =>
                typeof name !== "string" ||
                name.includes("...") ||
                !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(
                    name,
                ) ||
                excluded.includes(name),
        )
    ) {
        throw new Error("Invalid fan-out remainder package selection.");
    }
    return [
        {
            cwd: root,
            args: [
                "-r",
                "--no-bail",
                "--no-sort",
                "--stream",
                `--workspace-concurrency=${workspaceConcurrency}`,
                ...packages.map((name) => `--filter=${name}`),
                "run",
                "test:local",
            ],
        },
    ];
}

export function localTestCommands(
    profile,
    root,
    workspaceConcurrency = 3,
    packages,
) {
    if (
        !Number.isSafeInteger(workspaceConcurrency) ||
        workspaceConcurrency < 1
    ) {
        throw new Error(
            "TYPEAGENT_TEST_WORKSPACE_CONCURRENCY must be a positive safe integer.",
        );
    }
    if (profile === "fanout-lane") {
        return laneCommand(root, workspaceConcurrency, packages);
    }
    if (["full", "full-without-memory", "fanout-remainder"].includes(profile)) {
        return [
            {
                cwd: root,
                args: [
                    "-r",
                    "--no-bail",
                    "--no-sort",
                    "--stream",
                    `--workspace-concurrency=${workspaceConcurrency}`,
                    ...(profile !== "full"
                        ? ["--filter=!@typeagent/memory-service"]
                        : []),
                    ...(profile === "fanout-remainder"
                        ? Object.values(partitionPackages).map(
                              ({ name }) => `--filter=!${name}`,
                          )
                        : []),
                    "run",
                    "test:local",
                ],
            },
        ];
    }
    if (
        profile !== "macos-compat" &&
        profile !== "macos-compat-without-memory"
    ) {
        throw new Error(`Unknown TYPEAGENT_TEST_PROFILE: ${profile}`);
    }
    return macosCompatibilitySuites
        .filter(
            ({ directory }) =>
                profile !== "macos-compat-without-memory" ||
                directory !== "packages/memory/service",
        )
        .map(({ directory, files }) => ({
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
    workspaceConcurrency = 3,
    packages,
    run = spawnSync,
}) {
    const commands = localTestCommands(
        profile,
        root,
        workspaceConcurrency,
        packages,
    );
    if (!pnpmPath || !fs.existsSync(pnpmPath)) {
        throw new Error("Run local package tests through pnpm run.");
    }
    if (
        profile === "macos-compat" ||
        profile === "macos-compat-without-memory"
    ) {
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
        workspaceConcurrency: Number(
            process.env.TYPEAGENT_TEST_WORKSPACE_CONCURRENCY ?? "3",
        ),
        packages: process.env.TYPEAGENT_TEST_PACKAGES_JSON
            ? JSON.parse(process.env.TYPEAGENT_TEST_PACKAGES_JSON)
            : undefined,
    });
}
