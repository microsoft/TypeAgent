// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import yaml from "js-yaml";
import {
    localTestCommands,
    macosCompatibilitySuites,
    runLocalTestPackages,
    spawnPnpm,
} from "../runLocalTestPackages.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("legacy rollback retains Node 24/26 and full nightly/manual test coverage", () => {
    const workflow = yaml.load(
        fs.readFileSync(
            new URL(
                "../../../../.github/workflows/build-ts.yml",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    assert.equal(workflow.on.schedule[0].cron, "17 8 * * *");
    const job = workflow.jobs.build_ts_legacy;
    const step = job.steps.find((step) => step.name === "Test");
    const evaluate = (expression, event, os) =>
        vm.runInNewContext(expression.slice(3, -2), {
            github: { event_name: event },
            runner: { os },
            fromJSON: JSON.parse,
        });
    for (const event of [
        "pull_request",
        "merge_group",
        "push",
        "workflow_dispatch",
        "schedule",
    ]) {
        const matrix = Array.from(evaluate(job.strategy.matrix.os, event));
        assert.deepEqual(
            matrix,
            event === "schedule"
                ? ["macos-latest"]
                : ["ubuntu-latest", "windows-latest", "macos-latest"],
        );
        for (const os of ["Linux", "Windows", "macOS"]) {
            assert.equal(
                evaluate(step.env.TYPEAGENT_TEST_PROFILE, event, os),
                os === "macOS" &&
                    !["schedule", "workflow_dispatch"].includes(event)
                    ? "macos-compat"
                    : "full",
            );
        }
    }
    assert.deepEqual(job.strategy.matrix.version, ["24.22.1", "26.12.1"]);
    assert.equal(step.shell, "pwsh");
    assert.match(step.run, /exit \$LASTEXITCODE/);
});

test("full profile preserves the existing workspace selection and concurrency", () => {
    assert.deepEqual(localTestCommands("full", root), [
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
    ]);
});

test("full profile can serialize packages without changing test selection", () => {
    const expected = localTestCommands("full", root);
    expected[0].args = expected[0].args.map((arg) =>
        arg === "--workspace-concurrency=3" ? "--workspace-concurrency=1" : arg,
    );
    assert.deepEqual(localTestCommands("full", root, 1), expected);
});

test("fan-out remainder excludes only memory service and retains complete package scripts", () => {
    const full = localTestCommands("full", root);
    const remainder = localTestCommands("full-without-memory", root);
    assert.equal(remainder.length, 1);
    assert.equal(
        remainder[0].args.filter((arg) => arg.startsWith("--filter")).length,
        1,
    );
    assert.ok(
        remainder[0].args.includes("--filter=!@typeagent/memory-service"),
    );
    assert.deepEqual(
        remainder.map(({ cwd, args }) => ({
            cwd,
            args: args.filter((arg) => !arg.startsWith("--filter")),
        })),
        full,
    );
});

test("macOS fan-out remainder preserves exactly the non-memory compatibility suites", () => {
    const full = localTestCommands("macos-compat", root);
    const remainder = localTestCommands("macos-compat-without-memory", root);
    assert.deepEqual(
        remainder,
        full.filter(
            ({ cwd }) => cwd !== path.resolve(root, "packages/memory/service"),
        ),
    );
    assert.equal(remainder.length, 4);
    assert.equal(remainder.flatMap(({ args }) => args.slice(3)).length, 8);
});

test("partitioned remainder removes exactly memory, dispatcher and provider package scripts", () => {
    const remainder = localTestCommands("fanout-remainder", root);
    assert.deepEqual(
        remainder[0].args.filter((arg) => arg.startsWith("--filter=")),
        [
            "--filter=!@typeagent/memory-service",
            "--filter=!agent-dispatcher",
            "--filter=!default-agent-provider",
        ],
    );
    assert.deepEqual(
        remainder[0].args.filter((arg) => !arg.startsWith("--filter=")),
        localTestCommands("full", root)[0].args,
    );
});
test("invalid workspace concurrency fails before launching any package", () => {
    for (const workspaceConcurrency of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        assert.throws(
            () =>
                runLocalTestPackages({
                    profile: "full",
                    root,
                    pnpmPath: process.execPath,
                    workspaceConcurrency,
                    run: () => assert.fail("Must not start invalid commands"),
                }),
            /TYPEAGENT_TEST_WORKSPACE_CONCURRENCY/,
        );
    }
});

test("the command-line runner forwards the pipeline concurrency environment", (t) => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-concurrency-"),
    );
    t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    const pnpmPath = path.join(directory, "pnpm.cjs");
    fs.writeFileSync(
        pnpmPath,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
    );
    const result = spawnSync(
        process.execPath,
        [
            fileURLToPath(
                new URL("../runLocalTestPackages.mjs", import.meta.url),
            ),
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                npm_execpath: pnpmPath,
                TYPEAGENT_TEST_PROFILE: "full",
                TYPEAGENT_TEST_WORKSPACE_CONCURRENCY: "1",
            },
            encoding: "utf8",
            timeout: 30000,
        },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
        JSON.parse(result.stdout),
        localTestCommands("full", root, 1)[0].args,
    );
});

test("compatibility selection is explicit, unique, and references existing source tests", () => {
    const commands = localTestCommands("macos-compat", root);
    assert.equal(commands.length, 5);
    const files = commands.flatMap(({ args }) => args.slice(3));
    assert.equal(files.length, 13);
    assert.equal(new Set(files).size, files.length);
    for (const { directory, files } of macosCompatibilitySuites) {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, directory, "package.json"), "utf8"),
        );
        assert.match(manifest.scripts["jest-esm"], /jest/);
        for (const file of files) {
            assert.ok(
                fs
                    .statSync(
                        path.join(root, directory, "test", `${file}.spec.ts`),
                    )
                    .isFile(),
            );
        }
    }
});

test("root script phase retains memory-quality checks for direct and summarized CI runs", () => {
    const { scripts } = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    assert.equal(
        scripts["test:local"],
        "pnpm run test:local:packages && pnpm run test:local:scripts",
    );
    assert.equal(
        scripts["test:local:scripts"],
        "node --test tools/scripts/test/*.spec.mjs && pnpm run test:memory-quality",
    );
    assert.match(scripts["test:memory-quality"], /longmemeval-\*\.test\.mjs/);
});

test("unknown profiles fail instead of silently selecting a different suite", () => {
    assert.throws(() => localTestCommands("macos-typo", root), /Unknown/);
});

for (const profile of ["macos-compat", "macos-compat-without-memory"]) {
    test(`${profile} validates compiled files before running any package`, (t) => {
        const empty = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-profile-"),
        );
        t.after(() => fs.rmSync(empty, { force: true, recursive: true }));
        assert.throws(
            () =>
                runLocalTestPackages({
                    profile,
                    root: empty,
                    pnpmPath: process.execPath,
                    run: () => assert.fail("Must not start with missing tests"),
                }),
            /ENOENT|Missing compiled/,
        );
    });
}

test("profile runner preserves errors and invokes pnpm without shell interpolation", () => {
    const calls = [];
    assert.equal(
        runLocalTestPackages({
            profile: "full",
            root,
            pnpmPath: process.execPath,
            run: (command, args, options) => {
                calls.push({ command, args, cwd: options.cwd });
                return { status: 1 };
            },
        }),
        1,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.equal(calls[0].cwd, root);
    const error = new Error("spawn failed");
    assert.throws(
        () =>
            runLocalTestPackages({
                profile: "full",
                root,
                pnpmPath: process.execPath,
                run: () => ({ error }),
            }),
        error,
    );
});

test("nested pnpm preserves literal arguments and paths without invoking a shell", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-pnpm-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const manager = path.join(directory, "manager & literal");
    fs.mkdirSync(manager);
    const cli = path.join(manager, "pnpm.mjs");
    fs.writeFileSync(
        cli,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
    );
    const previous = process.env.npm_execpath;
    t.after(() => {
        if (previous === undefined) delete process.env.npm_execpath;
        else process.env.npm_execpath = previous;
    });
    process.env.npm_execpath = cli;
    const marker = path.join(directory, "injected.txt");
    const args = [
        "C:\\repo\\a&b",
        "%PATH%",
        'quote"literal',
        "line\nliteral",
        `x & echo injected > "${marker}"`,
    ];
    const result = spawnPnpm(args, { encoding: "utf8", shell: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
    assert.equal(fs.existsSync(marker), false);
    const error = new Error("nested spawn failed");
    assert.equal(spawnPnpm([], {}, () => ({ error })).error, error);
    assert.equal(spawnPnpm([], {}, () => ({ status: 7 })).status, 7);
});

test("nested pnpm rejects missing or non-pnpm package-script context", (t) => {
    const previous = process.env.npm_execpath;
    t.after(() => {
        if (previous === undefined) delete process.env.npm_execpath;
        else process.env.npm_execpath = previous;
    });
    for (const cli of [undefined, process.execPath]) {
        if (cli === undefined) delete process.env.npm_execpath;
        else process.env.npm_execpath = cli;
        assert.throws(
            () => spawnPnpm([], {}, () => assert.fail("Must not spawn")),
            /requires pnpm's JavaScript CLI/,
        );
    }
});
