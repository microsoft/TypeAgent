// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
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
} from "../runLocalTestPackages.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("workflow retains blocking Linux/Windows, macOS compatibility, and full nightly/manual coverage", () => {
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
    const job = workflow.jobs.build_ts;
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
    assert.deepEqual(job.strategy.matrix.version, [
        "22.23.4",
        "24.22.1",
        "26.12.1",
    ]);
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

test("unknown profiles fail instead of silently selecting a different suite", () => {
    assert.throws(() => localTestCommands("macos-typo", root), /Unknown/);
});

test("compatibility validates compiled files before running any package", (t) => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-profile-"));
    t.after(() => fs.rmSync(empty, { force: true, recursive: true }));
    assert.throws(
        () =>
            runLocalTestPackages({
                profile: "macos-compat",
                root: empty,
                pnpmPath: process.execPath,
                run: () => assert.fail("Must not start with missing tests"),
            }),
        /ENOENT|Missing compiled/,
    );
});

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
