// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { stageCopilotPlugin } from "../../../../tools/scripts/stageCopilotPlugin.mjs";
import {
    validateNativeStagedEntries,
    verifyNativeStagedManifest,
} from "../macro-eval-native.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
function fixture(root) {
    const files = {
        "package.json": '{"type":"module"}',
        ".mcp.json": "{}",
        "hooks.json": "{}",
        "plugin.json": '{"name":"typeagent","version":"1.0.0"}',
        "dist/hooks/hook-router.js":
            'import { direct } from "./hook-direct.js"; console.log(direct());',
        "dist/hooks/hook-direct.js":
            'import { status } from "../shared/status.js"; export const direct = () => status;',
        "dist/shared/status.js":
            'import data from "../assets/status.json" with {type:"json"}; export const status = data.text;',
        "dist/assets/status.json": '{"text":"complete-hook-runtime"}',
        "dist/assets/runtime.txt": "unbundled asset",
        "dist/mcp/server.js":
            'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url); import { status } from "../shared/status.js"; console.log(status);',
        "dist/extensions/typeagent/extension.mjs":
            "export default function extension() {}",
        "agents/runner.agent.md": "runner guidance",
        "skills/macro/SKILL.md": "macro guidance",
    };
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
}

test("canonical staging bundles router/direct/shared/MCP closure, retains assets and hashes unchanged extension", () => {
    const root = fs.mkdtempSync(path.join(directory, ".staging-test-"));
    try {
        const sourceRoot = path.join(root, "source");
        const out = path.join(root, "isolated");
        fixture(sourceRoot);
        stageCopilotPlugin(out, { sourceRoot });
        validateNativeStagedEntries(out);
        const extension = path.join(
            sourceRoot,
            "dist/extensions/typeagent/extension.mjs",
        );
        verifyNativeStagedManifest(out, extension);
        const target = path.join(out, "extensions/typeagent/extension.mjs");
        fs.appendFileSync(target, "\n// drift");
        assert.throws(
            () => verifyNativeStagedManifest(out, extension),
            /mismatch/,
        );
        fs.copyFileSync(extension, target);
        fs.appendFileSync(
            path.join(sourceRoot, "dist/shared/status.js"),
            "\n// drift",
        );
        assert.throws(
            () => verifyNativeStagedManifest(out, extension),
            /changed after staging/,
        );
        fs.rmSync(sourceRoot, { recursive: true });
        for (const entry of ["hooks/hook-router.js", "mcp/server.js"])
            assert.equal(
                execFileSync(
                    process.execPath,
                    [path.join(out, "dist", entry)],
                    { encoding: "utf8", cwd: root },
                ).trim(),
                "complete-hook-runtime",
            );
        assert.equal(
            fs.readFileSync(path.join(out, "dist/assets/runtime.txt"), "utf8"),
            "unbundled asset",
        );
        const manifest = JSON.parse(
            fs.readFileSync(path.join(out, "bundle-manifest.json"), "utf8"),
        );
        assert.ok(
            manifest.runtimeClosure.inputs.some((item) =>
                item.file.endsWith("hook-direct.js"),
            ),
        );
        assert.ok(
            manifest.runtimeClosure.inputs.some((item) =>
                item.file.endsWith("status.js"),
            ),
        );
        assert.match(
            manifest.runtimeClosure.extensionSha256,
            /^[a-f0-9]{64}$/u,
        );
        assert.equal(
            fs.readFileSync(
                path.join(out, "extensions/typeagent/extension.mjs"),
                "utf8",
            ),
            "export default function extension() {}",
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("missing hook-direct dependency fails canonical staging before launch", () => {
    const root = fs.mkdtempSync(path.join(directory, ".staging-negative-"));
    try {
        const sourceRoot = path.join(root, "source");
        fixture(sourceRoot);
        fs.unlinkSync(path.join(sourceRoot, "dist/hooks/hook-direct.js"));
        assert.throws(
            () => stageCopilotPlugin(path.join(root, "out"), { sourceRoot }),
            /Could not resolve.*hook-direct/su,
        );
        assert.equal(
            fs.existsSync(path.join(root, "out", "bundle-manifest.json")),
            false,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("current compiled product stages and all four real MCP modes initialize without a service, tool call or model", async () => {
    const root = fs.mkdtempSync(path.join(directory, ".current-stage-test-"));
    try {
        const out = path.join(root, "plugin");
        stageCopilotPlugin(out);
        validateNativeStagedEntries(out);
        verifyNativeStagedManifest(
            out,
            path.resolve(
                directory,
                "..",
                "..",
                "..",
                "copilot-plugin",
                "dist",
                "extensions",
                "typeagent",
                "extension.mjs",
            ),
        );
        const status = JSON.parse(
            execFileSync(
                process.execPath,
                [path.join(out, "dist", "hooks", "hook-router.js")],
                {
                    cwd: root,
                    encoding: "utf8",
                    timeout: 5000,
                    input: JSON.stringify({
                        sessionId: "staging-status-only",
                        cwd: root,
                        prompt: "@typeagent status",
                        timestamp: Date.now(),
                    }),
                    env: {
                        ...process.env,
                        CLAUDE_PLUGIN_DATA: path.join(root, "plugin-data"),
                        TYPEAGENT_USER_DATA_DIR: path.join(root, "data"),
                        TYPEAGENT_MODE: "bypass",
                    },
                    stdio: ["pipe", "pipe", "pipe"],
                },
            ),
        );
        assert.equal(status.handled, true);
        assert.match(status.responseContent, /TypeAgent Configuration/u);
        for (const mode of [[], ["--workspace"], ["--macros"], ["--skills"]]) {
            const transport = new StdioClientTransport({
                command: process.execPath,
                args: [path.join(out, "dist", "mcp", "server.js"), ...mode],
                cwd: root,
                stderr: "pipe",
                env: {
                    CLAUDE_PLUGIN_DATA: path.join(root, "plugin-data"),
                    TYPEAGENT_USER_DATA_DIR: path.join(root, "data"),
                    TYPEAGENT_MODE: "bypass",
                },
            });
            const client = new Client({
                name: "staging-initialize-only",
                version: "1.0.0",
            });
            try {
                await client.connect(transport, { timeout: 5000 });
                assert.ok(client.getServerVersion()?.name);
            } finally {
                await client.close();
            }
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
