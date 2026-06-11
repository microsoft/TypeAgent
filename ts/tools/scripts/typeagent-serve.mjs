#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * typeagent-serve — bootstrap launcher for the deployed agent-server.
 *
 * Shipped at the root of the `pnpm deploy` artifact (see deployAgentServer.mjs).
 * On a repo-less machine this is the single entry point: it ensures config is
 * provisioned and the WebSocket daemon (dist/server.js) is running on the agent
 * server port, reusing the daemon's own singleton/idle semantics — it does not
 * embed an MCP/stdio entry (the daemon stays a long-lived WebSocket service).
 *
 * Config location: both this launcher and getKeys must agree on where
 * config.local.yaml lives. We pin TYPEAGENT_CONFIG_DIR (defaulting to the user
 * data dir, ~/.typeagent) before spawning either, so getKeys writes exactly
 * where the @typeagent/config loader reads.
 *
 * Usage (from the artifact root):
 *   node typeagent-serve.mjs [start]   # ensure the daemon is up (default)
 *   node typeagent-serve.mjs provision # run getKeys to write config.local.yaml
 *   node typeagent-serve.mjs status    # report whether the daemon is listening
 *   node typeagent-serve.mjs stop       # stop the daemon (best effort)
 * Options: --port <n> (default $TYPEAGENT_PORT / $AGENT_SERVER_PORT / 8999),
 *          --idle-timeout <seconds>.
 */

import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(artifactDir, "dist", "server.js");
const getKeysEntry = path.join(artifactDir, "tools", "getKeys.mjs");

function arg(name) {
    const i = process.argv.indexOf(name);
    return i !== -1 ? process.argv[i + 1] : undefined;
}

function resolvePort() {
    const v =
        arg("--port") ??
        process.env.TYPEAGENT_PORT ??
        process.env.AGENT_SERVER_PORT;
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 8999;
}

// Pin the config dir so getKeys (write) and the server (read) agree. Honor an
// explicit override; otherwise the user data dir, matching the loader's fallback.
function pinnedConfigDir() {
    const dir =
        process.env.TYPEAGENT_CONFIG_DIR ??
        process.env.TYPEAGENT_USER_DATA_DIR ??
        path.join(os.homedir(), ".typeagent");
    process.env.TYPEAGENT_CONFIG_DIR = dir;
    return dir;
}

function isPortListening(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        const done = (result) => {
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}

async function waitForPort(port, timeoutMs = 60000, intervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isPortListening(port)) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

function runInline(entry, extraArgs) {
    // Inherit stdio so interactive flows (getKeys browser login) work.
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [entry, ...extraArgs], {
            stdio: "inherit",
            env: process.env,
        });
        child.on("exit", (code) => resolve(code ?? 0));
    });
}

function spawnDaemon(port) {
    const idle = arg("--idle-timeout");
    const args = [serverEntry, "--port", String(port)];
    if (idle) args.push("--idle-timeout", idle);
    const isWindows = process.platform === "win32";
    const child = spawn(process.execPath, args, {
        detached: !isWindows,
        windowsHide: true,
        stdio: "ignore",
        env: process.env,
    });
    child.unref();
}

async function cmdStart() {
    const port = resolvePort();
    if (await isPortListening(port)) {
        console.log(`Agent server already running on port ${port}.`);
        return 0;
    }
    if (!fs.existsSync(serverEntry)) {
        console.error(`Server entry not found at ${serverEntry}.`);
        return 1;
    }
    console.log(`Starting agent server (port ${port})...`);
    spawnDaemon(port);
    if (await waitForPort(port)) {
        console.log(`Agent server is up at ws://localhost:${port}.`);
        return 0;
    }
    console.error(
        `Agent server did not start. If this is a fresh install, run ` +
            `'node typeagent-serve.mjs provision' first to write config.local.yaml.`,
    );
    return 1;
}

async function cmdProvision() {
    if (!fs.existsSync(getKeysEntry)) {
        console.error(`getKeys not found at ${getKeysEntry}.`);
        return 1;
    }
    const dir = process.env.TYPEAGENT_CONFIG_DIR;
    console.log(
        `Provisioning config.local.yaml into ${dir} (browser login)...`,
    );
    // Pass through any extra args after the subcommand (e.g. --vault, --verbose).
    const passthrough = process.argv.slice(3).filter((a) => a !== "--port");
    return runInline(getKeysEntry, passthrough);
}

async function cmdStatus() {
    const port = resolvePort();
    const up = await isPortListening(port);
    console.log(
        up
            ? `Agent server is listening on port ${port}.`
            : `Agent server is not running on port ${port}.`,
    );
    return up ? 0 : 1;
}

async function main() {
    pinnedConfigDir();
    const cmd =
        process.argv[2] && !process.argv[2].startsWith("--")
            ? process.argv[2]
            : "start";
    switch (cmd) {
        case "start":
            return cmdStart();
        case "provision":
        case "getkeys":
            return cmdProvision();
        case "status":
            return cmdStatus();
        case "stop": {
            // Best-effort: defer to the deployed control utility if present.
            const stop = path.join(artifactDir, "dist", "stop.js");
            if (fs.existsSync(stop)) {
                return runInline(stop, ["--port", String(resolvePort())]);
            }
            console.error("stop.js not found in artifact.");
            return 1;
        }
        default:
            console.error(`Unknown command '${cmd}'.`);
            return 1;
    }
}

main().then((code) => process.exit(code));
