// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

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
