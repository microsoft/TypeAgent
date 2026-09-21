#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copilot starts hook and MCP entry points with a clean-enough environment
// that TypeAgent config and local embedding packages are not visible.
// runtime.json is written by the installer and is not committed.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryArg = process.argv[2];
if (!entryArg) {
    process.stderr.write("usage: node scripts/launch.mjs <entry>\n");
    process.exit(1);
}

const env = { ...process.env };
const runtimePath = path.join(pluginRoot, "runtime.json");
if (fs.existsSync(runtimePath)) {
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
    if (runtime.configDir && !env.TYPEAGENT_CONFIG_DIR) {
        env.TYPEAGENT_CONFIG_DIR = runtime.configDir;
    }
    if (runtime.nodePath) {
        env.NODE_PATH = [runtime.nodePath, env.NODE_PATH]
            .filter(Boolean)
            .join(path.delimiter);
    }
}

const entry = path.resolve(pluginRoot, entryArg);
const child = spawn(process.execPath, [entry], { env, stdio: "inherit" });
child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
