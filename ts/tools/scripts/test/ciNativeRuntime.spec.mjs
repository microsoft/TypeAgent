// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { probeSqlite, verifyNativeRuntimes } from "../lib/ciNativeRuntime.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const repository = path.dirname(root);
const workflow = (name) =>
    yaml.load(
        fs.readFileSync(
            path.join(repository, ".github/workflows", `${name}.yml`),
            "utf8",
        ),
    );
const setup = yaml.load(
    fs.readFileSync(
        path.join(repository, ".github/actions/fanout-setup/action.yml"),
        "utf8",
    ),
);
const install = setup.runs.steps.find((step) =>
    step.name?.startsWith("Install native dependencies"),
);

test("native reuse is explicit opt-in and forwarded to every fan-out install", () => {
    const main = workflow("build-ts");
    const experiment = workflow("ci-fanout-experiment");
    const target = workflow("ci-fanout-target");
    assert.equal(
        main.on.workflow_dispatch.inputs.fanout_native_cache.default,
        false,
    );
    assert.equal(
        experiment.on.workflow_call.inputs.native_cache.default,
        false,
    );
    assert.equal(target.on.workflow_call.inputs.native_cache.default, false);
    assert.equal(setup.inputs["native-cache"].default, "false");
    assert.equal(
        main.jobs.fanout_experiment.with.native_cache,
        "${{ inputs.fanout_native_cache }}",
    );
    assert.equal(
        experiment.jobs.targets.with.native_cache,
        "${{ inputs.native_cache }}",
    );
    const jobs = [experiment.jobs.analysis, ...Object.values(target.jobs)];
    for (const job of jobs) {
        assert.equal(
            job.steps.find(
                (step) => step.uses === "./.github/actions/fanout-setup",
            ).with["native-cache"],
            "${{ inputs.native_cache }}",
        );
    }
    assert.equal(
        main.jobs.build_ts.steps.find((step) =>
            step.uses?.startsWith("actions/setup-node@"),
        ).with.cache,
        "pnpm",
    );
    assert.ok(!JSON.stringify(main.jobs.build_ts).includes("native_cache"));
});

test("native stores isolate runtime, image, package-manager and build-policy identities", () => {
    const cache = setup.runs.steps.find((step) =>
        step.uses?.startsWith("actions/cache/restore@"),
    );
    assert.equal(cache.if, "inputs.native-cache == 'true'");
    assert.equal(cache.with.path, "${{ steps.native_identity.outputs.store }}");
    for (const expression of [
        "runner.os",
        "steps.native_identity.outputs.arch",
        "steps.native_identity.outputs.image",
        "steps.native_identity.outputs.image-version",
        "inputs.node-version",
        "steps.native_identity.outputs.abi",
    ])
        assert.ok(cache.with.key.includes(`\${{ ${expression} }}`), expression);
    for (const input of [
        "ts/package.json",
        "ts/pnpm-lock.yaml",
        "ts/pnpm-workspace.yaml",
        "ts/.pnpmfile.cjs",
    ]) {
        assert.ok(cache.with.key.includes(`'${input}'`), input);
    }
    assert.equal(
        cache.with["restore-keys"],
        "node-cache-${{ runner.os }}-${{ steps.native_identity.outputs.arch }}-pnpm-${{ hashFiles('ts/pnpm-lock.yaml') }}",
    );
    const node = setup.runs.steps.find((step) =>
        step.uses?.startsWith("actions/setup-node@"),
    );
    assert.equal(
        node.with.cache,
        "${{ inputs.native-cache != 'true' && 'pnpm' || '' }}",
    );
    assert.equal(node.with["package-manager-cache"], false);
    assert.equal(cache["continue-on-error"], undefined);
});

for (const missing of [undefined, "ImageOS", "ImageVersion"]) {
    test(`native cache identity executes with actual runner environment (${missing ?? "complete"})`, () => {
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-native-identity-"),
        );
        try {
            const output = path.join(directory, "outputs.txt");
            const script = path.join(directory, "identity.ps1");
            const identity = setup.runs.steps.find(
                (step) => step.id === "native_identity",
            );
            fs.writeFileSync(
                script,
                `
$ErrorActionPreference = 'Stop'
function pnpm {
  Write-Output 'fixture-store'
  $global:LASTEXITCODE = 0
}
${identity.run}
`,
            );
            const environment = {
                ...process.env,
                ImageOS: "fixture-image",
                ImageVersion: "20261106.1",
                GITHUB_OUTPUT: output,
            };
            if (missing) delete environment[missing];
            const result = spawnSync(
                "pwsh",
                ["-NoProfile", "-NonInteractive", "-File", script],
                {
                    encoding: "utf8",
                    env: environment,
                    timeout: 30000,
                },
            );
            assert.ifError(result.error);
            if (missing) {
                assert.notEqual(result.status, 0);
                assert.match(
                    result.stderr,
                    /runner image identity is required/,
                );
                return;
            }
            assert.equal(result.status, 0, result.stderr);
            const outputs = Object.fromEntries(
                fs
                    .readFileSync(output, "utf8")
                    .trim()
                    .split(/\r?\n/)
                    .map((line) => {
                        const equals = line.indexOf("=");
                        return [line.slice(0, equals), line.slice(equals + 1)];
                    }),
            );
            assert.deepEqual(outputs, {
                store: "fixture-store",
                image: "fixture-image",
                "image-version": "20261106.1",
                arch: process.arch,
                abi: process.versions.modules,
            });
            const cache = setup.runs.steps.find((step) =>
                step.uses?.startsWith("actions/cache/restore@"),
            );
            const context = {
                "runner.os": "fixtureOS",
                "inputs.node-version": process.versions.node,
                ...Object.fromEntries(
                    Object.entries(outputs).map(([name, value]) => [
                        `steps.native_identity.outputs.${name}`,
                        value,
                    ]),
                ),
            };
            const key = cache.with.key.replace(
                /\$\{\{\s*(.*?)\s*\}\}/g,
                (_, expression) => {
                    if (expression.startsWith("hashFiles("))
                        return "a".repeat(64);
                    assert.ok(
                        Object.hasOwn(context, expression),
                        `Unavailable expression context: ${expression}`,
                    );
                    return context[expression];
                },
            );
            assert.equal(
                key,
                `fanout-native-v2-fixtureOS-${process.arch}-fixture-image-20261106.1-node-${process.versions.node}-abi-${process.versions.modules}-${"a".repeat(64)}`,
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
}

test("SQLite probe performs actual native reads and writes in Node", () => {
    const result = probeSqlite(root, "node");
    assert.equal(result.runtime, "node");
    assert.equal(result.abi, process.versions.modules);
    assert.match(result.packageVersion, /^\d+\.\d+\.\d+$/);
    assert.match(result.sqliteVersion, /^\d+\.\d+\.\d+$/);
    assert.throws(() => probeSqlite(root, "electron"), /Wrong runtime/);
    assert.throws(() => probeSqlite(root, "unknown"), /Unknown native runtime/);
});

test("only each memory producer publishes the verified store before building, never workspace or consumers", () => {
    const jobs = workflow("ci-fanout-target").jobs;
    for (const [name, job] of Object.entries(jobs)) {
        const prepare = job.steps.find(
            (step) => step.uses === "./.github/actions/fanout-setup",
        );
        assert.equal(
            prepare.with["save-native-cache"],
            name === "build" ? "true" : undefined,
        );
    }
    const analysis = workflow("ci-fanout-experiment").jobs.analysis;
    assert.equal(
        analysis.steps.find(
            (step) => step.uses === "./.github/actions/fanout-setup",
        ).with["save-native-cache"],
        undefined,
    );
    const restore = setup.runs.steps.findIndex(
        (step) => step.id === "native_store",
    );
    const installIndex = setup.runs.steps.indexOf(install);
    const save = setup.runs.steps.findIndex((step) =>
        step.uses?.startsWith("actions/cache/save@"),
    );
    assert.ok(restore < installIndex && installIndex < save);
    assert.equal(setup.inputs["save-native-cache"].default, "false");
    assert.equal(
        setup.runs.steps[save].if,
        "inputs.native-cache == 'true' && inputs.save-native-cache == 'true' && steps.native_store.outputs.cache-hit != 'true'",
    );
    assert.equal(
        setup.runs.steps[save].with.path,
        "${{ steps.native_identity.outputs.store }}",
    );
    assert.equal(
        setup.runs.steps[save].with.key,
        "${{ steps.native_store.outputs.cache-primary-key }}",
    );
    assert.equal(
        setup.runs.steps.filter((step) =>
            step.uses?.startsWith("actions/cache@"),
        ).length,
        0,
    );
});

test("Node and Electron probes are separate processes with distinct runtime expectations", () => {
    const calls = [];
    verifyNativeRuntimes(root, {
        electronExecutable: "fixture-electron",
        run: (...args) => {
            calls.push(args);
            return { status: 0 };
        },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], process.execPath);
    assert.equal(calls[1][0], "fixture-electron");
    for (const [index, runtime] of ["node", "electron"].entries()) {
        assert.deepEqual(calls[index][1].slice(1), ["probe", runtime]);
        assert.equal(calls[index][2].cwd, root);
        assert.equal(calls[index][2].timeout, 60000);
        assert.equal(calls[index][2].stdio, "inherit");
    }
    assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(calls[1][2].env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(calls[1][2].env.NODE_OPTIONS, "");
});

for (const [runtime, failure] of [
    ["Node", { status: 1 }],
    ["Electron", { status: 1 }],
    ["Node", { status: null, signal: "SIGTERM" }],
    ["Electron", { error: new Error("fixture executable unavailable") }],
]) {
    test(`${runtime} probe failures cannot become successful native verification`, () => {
        let calls = 0;
        assert.throws(
            () =>
                verifyNativeRuntimes(root, {
                    electronExecutable: "fixture-electron",
                    run: () =>
                        ++calls === (runtime === "Node" ? 1 : 2)
                            ? failure
                            : { status: 0 },
                }),
            new RegExp(`${runtime} native verification`),
        );
        assert.equal(calls, runtime === "Node" ? 1 : 2);
    });
}

function installFixture({
    nativeCache,
    installFailure = "false",
    probeFailure = "false",
}) {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-native-retry-"),
    );
    const records = path.join(directory, "calls.txt");
    const harness = path.join(directory, "install.ps1");
    const record = `Add-Content -LiteralPath '${records.replaceAll("'", "''")}' -Value`;
    fs.writeFileSync(
        harness,
        `
$ErrorActionPreference = 'Stop'
$global:installs = 0
$global:probes = 0
function pnpm {
  $global:installs++
  ${record} ("install:" + ($args -join ' '))
  $global:LASTEXITCODE = if (${installFailure}) { 1 } else { 0 }
}
function node {
  $global:probes++
  ${record} 'probe'
  $global:LASTEXITCODE = if (${probeFailure}) { 1 } else { 0 }
}
function Start-Sleep {}
${install.run.replaceAll("\${{ inputs.native-cache }}", String(nativeCache))}
`
            .replaceAll("if (false)", "if ($false)")
            .replaceAll("if (true)", "if ($true)"),
    );
    try {
        const result = spawnSync(
            "pwsh",
            ["-NoProfile", "-NonInteractive", "-File", harness],
            {
                encoding: "utf8",
                timeout: 30000,
            },
        );
        assert.ifError(result.error);
        return {
            ...result,
            calls: fs.readFileSync(records, "utf8").trim().split(/\r?\n/),
        };
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test("default installation preserves its flags and does not add native probes", () => {
    const result = installFixture({ nativeCache: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, [
        "install:install --frozen-lockfile --strict-peer-dependencies",
    ]);
});

test("native cache hits still require both runtime probes", () => {
    const result = installFixture({ nativeCache: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, [
        "install:install --frozen-lockfile --strict-peer-dependencies --side-effects-cache",
        "probe",
    ]);
});

for (const stage of ["installation", "verification"]) {
    test(`${stage} failure forces uncached reimport before accepting a retry`, () => {
        const result = installFixture({
            nativeCache: true,
            installFailure:
                stage === "installation" ? "$global:installs -eq 1" : "false",
            probeFailure:
                stage === "verification" ? "$global:probes -eq 1" : "false",
        });
        assert.equal(result.status, 0, result.stderr);
        const installs = result.calls.filter((call) =>
            call.startsWith("install:"),
        );
        assert.equal(installs.length, 2);
        assert.equal(
            installs[1],
            "install:install --frozen-lockfile --strict-peer-dependencies --force --no-side-effects-cache",
        );
        assert.equal(result.calls.at(-1), "probe");
        assert.match(result.stdout, /::warning::.*uncached native rebuild/);
    });
}

test("persistent runtime failure exhausts three visible attempts and fails the job", () => {
    const result = installFixture({ nativeCache: true, probeFailure: "true" });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.filter((call) => call === "probe").length, 3);
    assert.equal(
        result.calls.filter((call) => call.startsWith("install:")).length,
        3,
    );
    assert.match(
        result.stderr,
        /native runtime verification exhausted 3 attempts/,
    );
});
