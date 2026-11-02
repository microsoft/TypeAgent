// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const pipeline = yaml.load(
    fs.readFileSync(
        new URL(
            "../../../../pipelines/azure-build-publish-all.yml",
            import.meta.url,
        ),
        "utf8",
    ),
);
const runtimeRequire = createRequire(
    new URL(
        "../../../packages/agentServer/bundledRuntime/package.json",
        import.meta.url,
    ),
);
const onnxPackage = runtimeRequire.resolve("onnxruntime-node/package.json");
const installer = path.join(path.dirname(onnxPackage), "script", "install.js");
const installSetting = pipeline.variables.find(
    (variable) => variable.name === "ONNXRUNTIME_NODE_INSTALL",
)?.value;

test("publishing selects CPU-only ONNX installation for every job", () => {
    assert.equal(installSetting, "skip");
    const workspace = yaml.load(
        fs.readFileSync(
            new URL("../../../pnpm-workspace.yaml", import.meta.url),
            "utf8",
        ),
    );
    assert.equal(workspace.allowBuilds["onnxruntime-node"], true);
});

test("publishing uses the standard Node heap budget and CI test settings", () => {
    const variables = Object.fromEntries(
        pipeline.variables.map(({ name, value }) => [name, value]),
    );
    const smoke = yaml.load(
        fs.readFileSync(
            new URL(
                "../../../../pipelines/azure-smoke-tests.yml",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    assert.equal(variables.CI, "true");
    assert.equal(
        variables.NODE_OPTIONS,
        smoke.variables.find(({ name }) => name === "NODE_OPTIONS").value,
    );
    const result = spawnSync(
        process.execPath,
        ["-p", "require('node:v8').getHeapStatistics().heap_size_limit"],
        {
            env: { ...process.env, NODE_OPTIONS: variables.NODE_OPTIONS },
            encoding: "utf8",
            timeout: 30000,
        },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Number(result.stdout.trim()) >= 8192 * 1024 * 1024);
});

test("the publishing gate retains all local tests with serialized packages", () => {
    const job = pipeline.stages
        .find(({ stage }) => stage === "Test")
        .jobs.find(({ job }) => job === "unit_tests");
    assert.equal(job.timeoutInMinutes, 150);
    const step = job.steps.find(
        ({ displayName }) => displayName === "Run Tests (Local)",
    );
    assert.equal(step.script.trim(), "npm run test:local");
    assert.equal(step.env.TYPEAGENT_TEST_WORKSPACE_CONCURRENCY, "1");
});

test("publishing lint excludes compiled Coda tests but retains source checks", async () => {
    const { getFileInfo } = require("prettier");
    const ignorePath = fileURLToPath(
        new URL("../../../.prettierignore", import.meta.url),
    );
    for (const [file, ignored] of [
        ["dist-test/test/workspaceCommandPolicy.spec.js", true],
        ["dist-test/test/workspaceCommandRunner.spec.js", true],
        ["dist-test/workspaceCommandPolicy.js", true],
        ["dist-test/workspaceCommandRunner.js", true],
        ["src/test/workspaceCommandPolicy.spec.ts", false],
        ["src/test/workspaceCommandRunner.spec.ts", false],
    ]) {
        const info = await getFileInfo(
            fileURLToPath(
                new URL(`../../../packages/coda/${file}`, import.meta.url),
            ),
            { ignorePath },
        );
        assert.equal(info.ignored, ignored, file);
    }
});

test("publishing fetches the lint ratchet base before running lint", () => {
    const step = pipeline.stages
        .find(({ stage }) => stage === "Test")
        .jobs.find(({ job }) => job === "unit_tests")
        .steps.find(({ displayName }) => displayName === "Lint");
    assert.deepEqual(step.script.trim().split("\n"), [
        "set -e",
        "git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main",
        "npm run lint",
    ]);
});

test("the Linux x64 ONNX installer avoids NuGet only with the publishing setting", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (/^(?:npm_config_)?onnxruntime_node_install(?:_cuda)?$/i.test(key)) {
            delete env[key];
        }
    }
    delete env.npm_config_local_prefix;
    const script = `
        const os = require("node:os");
        os.platform = () => "linux";
        os.arch = () => "x64";
        const fs = require("node:fs");
        const exists = fs.existsSync;
        fs.existsSync = (file) => String(file).endsWith("libonnxruntime_providers_cuda.so") ? false : exists(file);
        require("node:https").get = () => { throw new Error("NuGet download attempted"); };
        require(${JSON.stringify(installer)});
    `;
    const original = spawnSync(process.execPath, ["-e", script], {
        env,
        encoding: "utf8",
        timeout: 30000,
    });
    assert.ifError(original.error);
    assert.equal(original.status, 1);
    assert.match(original.stderr, /NuGet download attempted/);

    const fixed = spawnSync(process.execPath, ["-e", script], {
        env: { ...env, ONNXRUNTIME_NODE_INSTALL: installSetting },
        encoding: "utf8",
        timeout: 30000,
    });
    assert.ifError(fixed.error);
    assert.equal(fixed.status, 0, fixed.stderr);
});

test("ONNX still loads its native CPU backend", () => {
    const runtime = runtimeRequire("onnxruntime-node");
    assert.ok(
        runtime
            .listSupportedBackends()
            .some((backend) => backend.name === "cpu" && backend.bundled),
    );
});
