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
 *   node typeagent-serve.mjs autostart [enable|disable|status]  # register a
 *                                       # per-user OS trigger (Scheduled Task /
 *                                       # systemd user unit / LaunchAgent) so the
 *                                       # daemon starts again after logout/reboot
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

const selfPath = fileURLToPath(import.meta.url);
const artifactDir = path.dirname(selfPath);
const serverEntry = path.join(artifactDir, "dist", "server.js");
const getKeysEntry = path.join(artifactDir, "tools", "getKeys.mjs");
const generateConfigEntry = path.join(
    artifactDir,
    "tools",
    "generate-selfhost-config.mjs",
);

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

function daemonLogPath() {
    return path.join(userDataDir(), "agent-server.log");
}

function isDebugMode() {
    const v = process.env.TYPEAGENT_DEBUG;
    return (
        process.argv.includes("--debug") ||
        (v !== undefined && v !== "0" && v !== "false" && v !== "")
    );
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

    const debugMode = isDebugMode();

    // In debug mode redirect daemon stdout/stderr to a log file and enable the
    // debug namespace so startup failures are captured instead of silently lost.
    let stdio = "ignore";
    const env = { ...process.env };
    if (debugMode) {
        const logPath = daemonLogPath();
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logFd = fs.openSync(logPath, "a");
        stdio = ["ignore", logFd, logFd];
        if (!env.DEBUG) env.DEBUG = "typeagent:*";
        console.log(`[debug] Daemon log: ${logPath}`);
        // Close our copy of the fd after spawn so the child owns it.
        setTimeout(() => {
            try {
                fs.closeSync(logFd);
            } catch {}
        }, 1000);
    }

    if (isWindows && !debugMode) {
        // Detached node processes on Windows can create visible console windows
        // (including for spawned descendants). Use cmd `start /B` to keep the
        // daemon backgrounded without opening extra windows.
        const child = spawn(
            "cmd.exe",
            ["/d", "/c", "start", "", "/B", process.execPath, ...args],
            {
                windowsHide: true,
                stdio: "ignore",
                env,
            },
        );
        child.unref();
        return;
    }

    const child = spawn(process.execPath, args, {
        // The launcher is short-lived. Detach on all platforms so the daemon
        // survives after this process exits; otherwise on Windows it can die
        // immediately after reporting startup success.
        detached: true,
        windowsHide: true,
        stdio,
        env,
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
        // Detect running from the repo source tree (not a deployed artifact).
        const inRepo = fs.existsSync(
            path.join(artifactDir, "..", "..", "package.json"),
        );
        if (inRepo) {
            console.error(
                `typeagent-serve.mjs 'start' is for the deployed artifact only.\n` +
                    `In development, start the agent-server with:\n` +
                    `  cd packages/agentServer/server && pnpm start\n` +
                    `  (or: pnpm run start:tunnel   — to also bring up the dev tunnel)\n\n` +
                    `Tunnel host commands (tunnel start/stop/status) work from here.`,
            );
        } else {
            console.error(`Server entry not found at ${serverEntry}.`);
        }
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
    const logPath = daemonLogPath();
    const logHint = fs.existsSync(logPath)
        ? `\nDaemon log: ${logPath}`
        : `\nRe-run with TYPEAGENT_DEBUG=1 (or --debug) to capture daemon output to ${logPath}`;
    console.error(
        `Agent server did not start. If this is a fresh install, run ` +
            `'node typeagent-serve.mjs provision' first to write config.local.yaml.` +
            logHint,
    );
    return 1;
}

async function cmdProvision() {
    // Chat endpoint provider. Default 'aisystems' preserves today's behavior
    // (Key Vault download via getKeys). 'ollama'/'copilot' synthesize a
    // config.local.yaml locally with generate-selfhost-config (no Key Vault).
    const provider = (arg("--provider") ?? "aisystems").toLowerCase();

    if (provider === "ollama" || provider === "copilot") {
        if (!fs.existsSync(generateConfigEntry)) {
            console.error(
                `Self-host config generator not found at ${generateConfigEntry}.`,
            );
            return 1;
        }
        const dir = process.env.TYPEAGENT_CONFIG_DIR;
        console.log(
            `Generating config.local.yaml for '${provider}' provider into ${dir}...`,
        );
        // Forward provider + all generator options; drop launcher-only flags.
        const drop = new Set(["--port"]);
        const passthrough = process.argv.slice(3).filter((a) => !drop.has(a));
        return runInline(generateConfigEntry, passthrough);
    }

    if (provider !== "aisystems") {
        console.error(
            `Unknown --provider '${provider}'. Use aisystems, ollama, or copilot.`,
        );
        return 1;
    }

    if (!fs.existsSync(getKeysEntry)) {
        console.error(`getKeys not found at ${getKeysEntry}.`);
        return 1;
    }
    const dir = process.env.TYPEAGENT_CONFIG_DIR;
    console.log(
        `Provisioning config.local.yaml into ${dir} (browser login)...`,
    );
    // Pass through any extra args after the subcommand (e.g. --vault, --verbose).
    // Strip --provider/--port which getKeys does not understand.
    const passthrough = [];
    const rest = process.argv.slice(3);
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--provider") {
            i++; // skip its value
            continue;
        }
        if (rest[i] === "--port") continue;
        passthrough.push(rest[i]);
    }
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
    if (!up) {
        const logPath = daemonLogPath();
        if (fs.existsSync(logPath)) {
            console.log(`Daemon log: ${logPath}`);
        } else {
            console.log(
                `No daemon log found. Re-run 'node typeagent-serve.mjs start --debug' ` +
                    `(or set TYPEAGENT_DEBUG=1) to capture daemon output to ${logPath}`,
            );
        }
    }
    return up ? 0 : 1;
}

function cmdLogs() {
    const logPath = daemonLogPath();
    if (!fs.existsSync(logPath)) {
        console.log(`No daemon log found at ${logPath}.`);
        console.log(
            `Start with 'node typeagent-serve.mjs start --debug' or set TYPEAGENT_DEBUG=1 to enable logging.`,
        );
        return 0;
    }
    console.log(`=== Daemon log: ${logPath} ===`);
    const lines = fs.readFileSync(logPath, "utf8").split("\n");
    // Print last 200 lines by default; --all to show everything.
    const all = process.argv.includes("--all");
    const tail = all ? lines : lines.slice(-200);
    tail.forEach((l) => console.log(l));
    return 0;
}

// ---- Autostart / service registration -----------------------------------
// Register a per-user OS mechanism so the daemon comes back after logout/reboot:
//   Windows -> Scheduled Task (logon trigger) supervising dist/server.js in the
//              foreground, launched hidden through a wscript wait-shim so no
//              console window appears. A Scheduled Task terminates its action's
//              process tree when the action exits, so a fire-and-forget detached
//              daemon would be killed; the task action must stay alive for the
//              server's lifetime.
//   Linux   -> systemd user unit supervising dist/server.js (Restart=on-failure).
//   macOS   -> LaunchAgent supervising dist/server.js (KeepAlive).
// Install is per-user everywhere, so none of these need admin. Each variant runs
// the server in the foreground so its supervisor can stop and restart it.

const AUTOSTART_TASK_NAME = "TypeAgent Agent Server";
const AUTOSTART_LABEL = "com.microsoft.typeagent.agent-server";
const AUTOSTART_SYSTEMD_UNIT = "typeagent-agent-server.service";

function autostartAction() {
    const a = process.argv[3];
    return a && !a.startsWith("--") ? a : "status";
}

// Foreground server args (mirrors spawnDaemon, minus --idle-timeout: an
// autostarted service should stay up rather than self-exit when idle).
function autostartServerArgs(port) {
    const args = [serverEntry, "--port", String(port)];
    const profile =
        arg("--config") ??
        process.env.TYPEAGENT_AGENT_PROFILE ??
        readProfileMarker();
    if (profile) args.push("--config", profile);
    return args;
}

// Pin the config dir the same way the launcher does, so the supervised server
// reads config from where getKeys wrote it.
function autostartEnv() {
    const env = { TYPEAGENT_CONFIG_DIR: pinnedConfigDir() };
    if (process.env.TYPEAGENT_USER_DATA_DIR) {
        env.TYPEAGENT_USER_DATA_DIR = process.env.TYPEAGENT_USER_DATA_DIR;
    }
    return env;
}

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, { encoding: "utf-8", ...opts });
}

function psQuote(s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
}

function windowsShimPath() {
    return path.join(artifactDir, "autostart-run.vbs");
}

// A WScript shim that launches the server hidden (window style 0) and WAITS for
// it (bWaitOnReturn = True). Waiting keeps the shim alive as the Scheduled Task's
// action for the server's whole lifetime, so Task Scheduler treats the task as
// running and does not tear down the server; window style 0 hides node's console.
function windowsShimContent(port) {
    const cmdline = [process.execPath, ...autostartServerArgs(port)]
        .map((a) => `"${a}"`)
        .join(" ");
    const runLiteral = `"${cmdline.replace(/"/g, '""')}"`;
    const envLines = Object.entries(autostartEnv())
        .map(([k, v]) => `env("${k}") = "${String(v).replace(/"/g, '""')}"`)
        .join("\r\n");
    return (
        `Set sh = CreateObject("WScript.Shell")\r\n` +
        `Set env = sh.Environment("Process")\r\n` +
        (envLines ? envLines + "\r\n" : "") +
        `sh.Run ${runLiteral}, 0, True\r\n`
    );
}

async function autostartWindows(action, port) {
    const powershell = "powershell.exe";
    const shim = windowsShimPath();
    if (action === "enable") {
        fs.writeFileSync(shim, windowsShimContent(port));
        const ps =
            `$ErrorActionPreference='Stop';` +
            `$u="$env:USERDOMAIN\\$env:USERNAME";` +
            `$a=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psQuote(`"${shim}"`)};` +
            `$t=New-ScheduledTaskTrigger -AtLogOn -User $u;` +
            `$p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive;` +
            `$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1);` +
            `Register-ScheduledTask -TaskName ${psQuote(AUTOSTART_TASK_NAME)} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null;`;
        const r = run(powershell, [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            ps,
        ]);
        if (r.status !== 0) {
            console.error(
                `Failed to register scheduled task.\n${r.stderr ?? ""}`.trim(),
            );
            return 1;
        }
        console.log(
            `Registered scheduled task "${AUTOSTART_TASK_NAME}" (starts the agent server at logon).`,
        );
        return 0;
    }
    if (action === "disable") {
        run(powershell, [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            // Stop-ScheduledTask ends the wscript action, but node launched via
            // WScript.Shell.Run escapes the task's job object and is orphaned, so
            // also terminate the server started from THIS artifact's server.js
            // (matched by command line, leaving any unrelated server untouched).
            `$m=${psQuote(serverEntry)};` +
                `Stop-ScheduledTask -TaskName ${psQuote(AUTOSTART_TASK_NAME)} -ErrorAction SilentlyContinue;` +
                `Unregister-ScheduledTask -TaskName ${psQuote(AUTOSTART_TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue;` +
                `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like ('*'+$m+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };`,
        ]);
        try {
            fs.rmSync(shim, { force: true });
        } catch {}
        console.log(`Removed scheduled task "${AUTOSTART_TASK_NAME}".`);
        return 0;
    }
    const r = run(powershell, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `if(Get-ScheduledTask -TaskName ${psQuote(AUTOSTART_TASK_NAME)} -ErrorAction SilentlyContinue){'registered'}else{'absent'}`,
    ]);
    const registered = (r.stdout ?? "").trim() === "registered";
    console.log(
        `Autostart (Scheduled Task "${AUTOSTART_TASK_NAME}"): ${registered ? "registered" : "not registered"}.`,
    );
    return registered ? 0 : 1;
}

function systemdUnitPath() {
    const base =
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
    return path.join(base, "systemd", "user", AUTOSTART_SYSTEMD_UNIT);
}

function systemdUnitContent(port) {
    const exec = [process.execPath, ...autostartServerArgs(port)]
        .map((a) => `"${a}"`)
        .join(" ");
    const envLines = Object.entries(autostartEnv())
        .map(([k, v]) => `Environment="${k}=${v}"`)
        .join("\n");
    return (
        `[Unit]\n` +
        `Description=TypeAgent Agent Server\n` +
        `After=network-online.target\n` +
        `Wants=network-online.target\n\n` +
        `[Service]\n` +
        `Type=simple\n` +
        `ExecStart=${exec}\n` +
        (envLines ? envLines + "\n" : "") +
        `Restart=on-failure\n` +
        `RestartSec=5\n\n` +
        `[Install]\n` +
        `WantedBy=default.target\n`
    );
}

async function autostartLinux(action, port) {
    if (run("systemctl", ["--version"]).status !== 0) {
        console.error(
            "systemd (systemctl) not found. Auto-start on Linux requires a systemd user session.",
        );
        return 1;
    }
    const unitPath = systemdUnitPath();
    if (action === "enable") {
        fs.mkdirSync(path.dirname(unitPath), { recursive: true });
        fs.writeFileSync(unitPath, systemdUnitContent(port));
        run("systemctl", ["--user", "daemon-reload"]);
        // The installer may already have started a detached daemon on this port;
        // enabling with --now would collide. Enable-only in that case and let
        // systemd take over at the next login/boot.
        const up = await isPortListening(port);
        const enableArgs = up
            ? ["--user", "enable", AUTOSTART_SYSTEMD_UNIT]
            : ["--user", "enable", "--now", AUTOSTART_SYSTEMD_UNIT];
        const r = run("systemctl", enableArgs);
        if (r.status !== 0) {
            console.error(
                `Failed to enable systemd unit.\n${r.stderr ?? ""}`.trim(),
            );
            return 1;
        }
        // Best-effort: keep the service running without an interactive login.
        const linger = run("loginctl", ["enable-linger"]);
        console.log(
            `Enabled systemd user unit ${AUTOSTART_SYSTEMD_UNIT} (${unitPath}).`,
        );
        if (up) {
            console.log(
                "A daemon is already running on the port; systemd takes over at the next login/boot.",
            );
        }
        if (linger.status !== 0) {
            console.log(
                "Note: 'loginctl enable-linger' failed; the service starts at login rather than at boot.",
            );
        }
        return 0;
    }
    if (action === "disable") {
        run("systemctl", [
            "--user",
            "disable",
            "--now",
            AUTOSTART_SYSTEMD_UNIT,
        ]);
        try {
            fs.rmSync(unitPath, { force: true });
        } catch {}
        run("systemctl", ["--user", "daemon-reload"]);
        console.log(`Disabled systemd user unit ${AUTOSTART_SYSTEMD_UNIT}.`);
        return 0;
    }
    const enabled = run("systemctl", [
        "--user",
        "is-enabled",
        AUTOSTART_SYSTEMD_UNIT,
    ]);
    const active = run("systemctl", [
        "--user",
        "is-active",
        AUTOSTART_SYSTEMD_UNIT,
    ]);
    const isEnabled = (enabled.stdout ?? "").trim() === "enabled";
    console.log(
        `Autostart (systemd user unit ${AUTOSTART_SYSTEMD_UNIT}): ${isEnabled ? "enabled" : "not enabled"}, ${(active.stdout ?? "").trim() || "inactive"}.`,
    );
    return isEnabled ? 0 : 1;
}

function launchAgentPath() {
    return path.join(
        os.homedir(),
        "Library",
        "LaunchAgents",
        `${AUTOSTART_LABEL}.plist`,
    );
}

function xmlEscape(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function launchAgentContent(port) {
    const programArgs = [process.execPath, ...autostartServerArgs(port)]
        .map((a) => `        <string>${xmlEscape(a)}</string>`)
        .join("\n");
    const envEntries = Object.entries(autostartEnv())
        .map(
            ([k, v]) =>
                `        <key>${xmlEscape(k)}</key>\n        <string>${xmlEscape(v)}</string>`,
        )
        .join("\n");
    const logPath = daemonLogPath();
    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
        `<plist version="1.0">\n` +
        `<dict>\n` +
        `    <key>Label</key>\n    <string>${AUTOSTART_LABEL}</string>\n` +
        `    <key>ProgramArguments</key>\n    <array>\n${programArgs}\n    </array>\n` +
        `    <key>EnvironmentVariables</key>\n    <dict>\n${envEntries}\n    </dict>\n` +
        `    <key>RunAtLoad</key>\n    <true/>\n` +
        `    <key>KeepAlive</key>\n    <true/>\n` +
        `    <key>StandardOutPath</key>\n    <string>${xmlEscape(logPath)}</string>\n` +
        `    <key>StandardErrorPath</key>\n    <string>${xmlEscape(logPath)}</string>\n` +
        `</dict>\n</plist>\n`
    );
}

async function autostartMac(action, port) {
    const plist = launchAgentPath();
    const uid = process.getuid ? process.getuid() : 0;
    const domain = `gui/${uid}`;
    if (action === "enable") {
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.mkdirSync(path.dirname(daemonLogPath()), { recursive: true });
        fs.writeFileSync(plist, launchAgentContent(port));
        // A daemon already listening (installer start) would collide on the port
        // and trip KeepAlive; defer loading to the next login in that case.
        if (await isPortListening(port)) {
            console.log(
                `Wrote LaunchAgent ${plist}. A daemon is already running; it will be supervised at the next login.`,
            );
            return 0;
        }
        let r = run("launchctl", ["bootstrap", domain, plist]);
        if (r.status !== 0) {
            r = run("launchctl", ["load", "-w", plist]);
        }
        if (r.status !== 0) {
            console.error(
                `Failed to load LaunchAgent.\n${r.stderr ?? ""}`.trim(),
            );
            return 1;
        }
        console.log(`Loaded LaunchAgent ${AUTOSTART_LABEL} (${plist}).`);
        return 0;
    }
    if (action === "disable") {
        run("launchctl", ["bootout", `${domain}/${AUTOSTART_LABEL}`]);
        run("launchctl", ["unload", "-w", plist]);
        try {
            fs.rmSync(plist, { force: true });
        } catch {}
        console.log(`Removed LaunchAgent ${AUTOSTART_LABEL}.`);
        return 0;
    }
    const registered = run("launchctl", ["list", AUTOSTART_LABEL]).status === 0;
    console.log(
        `Autostart (LaunchAgent ${AUTOSTART_LABEL}): ${registered ? "loaded" : "not loaded"}.`,
    );
    return registered ? 0 : 1;
}

async function cmdAutostart() {
    const action = autostartAction();
    if (!["enable", "disable", "status"].includes(action)) {
        console.error(
            `Unknown autostart action '${action}'. Use enable|disable|status.`,
        );
        return 1;
    }
    const port = resolvePort();
    switch (process.platform) {
        case "win32":
            return autostartWindows(action, port);
        case "linux":
            return autostartLinux(action, port);
        case "darwin":
            return autostartMac(action, port);
        default:
            console.error(
                `Autostart is not supported on platform '${process.platform}'.`,
            );
            return 1;
    }
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
        case "logs":
            return cmdLogs();
        case "autostart":
            return cmdAutostart();
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
