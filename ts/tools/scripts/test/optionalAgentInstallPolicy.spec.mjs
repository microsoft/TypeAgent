// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeRuntimeInstallWorkspace } from "../packageOptionalAgents.mjs";

const yaml = createRequire(import.meta.url)("js-yaml");

test("optional-agent installs explicitly deny protobufjs builds without weakening native builds", (t) => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-optional-policy-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const workspace = writeRuntimeInstallWorkspace(directory);
    const config = yaml.load(fs.readFileSync(workspace, "utf8"));
    const canonical = yaml.load(
        fs.readFileSync(
            new URL("../../../pnpm-workspace.yaml", import.meta.url),
            "utf8",
        ),
    );
    assert.deepEqual(config.packages, ["."]);
    assert.equal(config.allowBuilds.protobufjs, false);
    assert.equal(config.allowBuilds.puppeteer, false);
    assert.equal(config.allowBuilds["onnxruntime-node"], true);
    assert.equal(config.allowBuilds["better-sqlite3"], true);
    for (const [name, allowed] of Object.entries(config.allowBuilds)) {
        assert.equal(allowed, canonical.allowBuilds[name], name);
    }
});
