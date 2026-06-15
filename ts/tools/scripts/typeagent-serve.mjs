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
 *   node typeagent-serve.mjs tunnel [start|stop|status]  # manage the dev-tunnel
 *                                       # host so remote devices can reach the service
 * Options: --port <n> (default $TYPEAGENT_PORT / $AGENT_SERVER_PORT / 8999),
 *          --idle-timeout <seconds>,
 *          --tunnel (with start: also bring up the dev-tunnel host; or set
 *          $TYPEAGENT_TUNNEL=1). Requires a tunnel configured via setup-devtunnel.
 */

import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(artifactDir, "dist", "server.js");
const getKeysEntry = path.join(artifactDir, "tools", "getKeys.mjs");

// Profile recorded by deployAgentServer when the artifact was profile-pruned.
function readProfileMarker() {
    try {
        return (
            fs
                .readFileSync(
                    path.join(artifactDir, ".typeagent-profile"),
                    "utf8",
                )
                .trim() || undefined
        );
    } catch {
        return undefined;
    }
}

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
    // Agent profile: a reduced provider config (e.g. "service" ->
    // data/config.service.json) so the daemon loads only the agents this
    // deployment ships. Precedence: --config arg > env > the .typeagent-profile
    // marker written by deployAgentServer when the artifact was profile-pruned
    // (the pruned artifact CANNOT load excluded agents, so this default is
    // required for it to start). Unset everywhere = the full default config.json.
    const profile =
        arg("--config") ??
        process.env.TYPEAGENT_AGENT_PROFILE ??
        readProfileMarker();
    if (profile) args.push("--config", profile);
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
        // Opt-in: also bring up the dev-tunnel host so remote devices can reach
        // the service. Only when --tunnel/$TYPEAGENT_TUNNEL is set AND a tunnel
        // has been configured (setup-devtunnel wrote devtunnel.json).
        if (tunnelOptIn() && readDevTunnel() !== undefined) {
            await cmdTunnel("start");
        }
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

// ---- Dev-tunnel host management ----------------------------------------
// devtunnel.json (written by setup-devtunnel) and the host pidfile live in the
// user data dir — the same location the agent-server's discovery resolver reads.

function userDataDir() {
    return (
        process.env.TYPEAGENT_USER_DATA_DIR ??
        path.join(os.homedir(), ".typeagent")
    );
}

function readDevTunnel() {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(userDataDir(), "devtunnel.json"), "utf8"),
        );
    } catch {
        return undefined;
    }
}

// The CLI reports tunnelId as "<id>.<cluster>"; `devtunnel host` wants the id.
function bareTunnelId(cfg) {
    const { tunnelId, cluster } = cfg;
    if (cluster && tunnelId.endsWith(`.${cluster}`)) {
        return tunnelId.slice(0, -(cluster.length + 1));
    }
    const dot = tunnelId.indexOf(".");
    return dot > 0 ? tunnelId.slice(0, dot) : tunnelId;
}

function deriveWss(cfg) {
    const port = Object.keys(cfg.ports ?? {})[0] ?? "8999";
    return `wss://${bareTunnelId(cfg)}-${port}.${cfg.cluster}.devtunnels.ms`;
}

function tunnelPidFile() {
    return path.join(userDataDir(), "devtunnel-host.pid");
}

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readTunnelPid() {
    try {
        return parseInt(fs.readFileSync(tunnelPidFile(), "utf8").trim(), 10);
    } catch {
        return undefined;
    }
}

// Does the relay report a connected host? (Liveness, independent of our pidfile.)
function tunnelRelayLive(cfg) {
    const res = spawnSync("devtunnel", ["show", cfg.tunnelId, "--json"], {
        encoding: "utf-8",
    });
    if (res.status !== 0) return false;
    try {
        return (JSON.parse(res.stdout)?.tunnel?.hostConnections ?? 0) > 0;
    } catch {
        return false;
    }
}

async function cmdTunnel(actionArg) {
    const action =
        actionArg ??
        (process.argv[3] && !process.argv[3].startsWith("--")
            ? process.argv[3]
            : "status");
    const cfg = readDevTunnel();
    if (cfg === undefined) {
        console.error(
            "No tunnel configured. Run setup-devtunnel.mjs to create one.",
        );
        return 1;
    }
    const id = bareTunnelId(cfg);
    switch (action) {
        case "start": {
            const existing = readTunnelPid();
            if (existing !== undefined && pidAlive(existing)) {
                console.log(`Tunnel host already running (pid ${existing}).`);
                return 0;
            }
            console.log(`Starting tunnel host for ${id}...`);
            // `devtunnel host` exits if its stdout/stderr are the null device, so
            // direct them to a log file (which also aids debugging). Close our
            // copy of the fd after spawn — the detached child keeps its own.
            const logPath = path.join(userDataDir(), "devtunnel-host.log");
            const out = fs.openSync(logPath, "a");
            const child = spawn("devtunnel", ["host", id], {
                // Fully detach so the host outlives this short-lived launcher
                // (a non-detached child is terminated when its parent exits on
                // Windows). windowsHide keeps it from popping a console window.
                detached: true,
                windowsHide: true,
                stdio: ["ignore", out, out],
            });
            fs.closeSync(out);
            if (child.pid === undefined) {
                console.error(
                    "Failed to start devtunnel host (is the CLI installed and are you logged in?).",
                );
                return 1;
            }
            child.unref();
            fs.writeFileSync(tunnelPidFile(), String(child.pid));
            console.log(
                `Tunnel host started (pid ${child.pid}); log: ${logPath}`,
            );
            console.log(`Client URL: ${deriveWss(cfg)}`);
            return 0;
        }
        case "stop": {
            const pid = readTunnelPid();
            if (pid === undefined || !pidAlive(pid)) {
                console.log("Tunnel host not running.");
                try {
                    fs.rmSync(tunnelPidFile(), { force: true });
                } catch {}
                return 0;
            }
            try {
                if (process.platform === "win32") {
                    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
                } else {
                    process.kill(pid, "SIGTERM");
                }
            } catch {}
            try {
                fs.rmSync(tunnelPidFile(), { force: true });
            } catch {}
            console.log(`Tunnel host stopped (pid ${pid}).`);
            return 0;
        }
        case "status": {
            const pid = readTunnelPid();
            const running = pid !== undefined && pidAlive(pid);
            const live = tunnelRelayLive(cfg);
            console.log(
                `Tunnel ${cfg.tunnelId}: host process ${running ? `running (pid ${pid})` : "not running"}, relay ${live ? "LIVE" : "down"}.`,
            );
            console.log(`Client URL: ${deriveWss(cfg)}`);
            return live ? 0 : 1;
        }
        default:
            console.error(
                `Unknown tunnel action '${action}'. Use start|stop|status.`,
            );
            return 1;
    }
}

function tunnelOptIn() {
    const env = process.env.TYPEAGENT_TUNNEL;
    return (
        process.argv.includes("--tunnel") ||
        (env !== undefined && env !== "0" && env !== "false" && env !== "")
    );
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
        case "tunnel":
            return cmdTunnel();
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
