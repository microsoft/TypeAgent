// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAEMON_ROUTE } from "../server/router.js";
import { startServer } from "../server/server.js";

// One daemon per user, shared by every project. Each API request names its
// project by absolute path, so the daemon does not depend on any cwd.
//
//   git story daemon start            (from any directory)
//     └─ spawns detached `git-story daemon run`
//          └─ listens on 127.0.0.1:<free port>
//          └─ writes ~/.git-story/daemon.json {"pid":4242,"port":51234}
//   GET /api/story/commits/739e112?project=/Users/me/repo
//   GET /api/story/commits/739e112?project=C:\Users\me\repo  (URL-encoded)
//   git story daemon status  -> reads daemon.json, asks the port for its pid
//   git story daemon stop    -> kills pid; stale daemon.json is cleaned up
//
// `~` is os.homedir(): /Users/me on macOS, C:\Users\me on Windows.
const STATE_DIR = ".git-story";
const STATE_FILE = "daemon.json";
const LOG_FILE = "daemon.log";
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;
const POLL_MS = 50;
const IDENTITY_TIMEOUT_MS = 1000;

type DaemonState = { pid: number; port: number };

const CLI = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli.js",
);

const stateDir = () => path.join(os.homedir(), STATE_DIR);

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM: the process exists but belongs to another user.
        return (e as NodeJS.ErrnoException).code === "EPERM";
    }
}

// True when the server on `state.port` reports `state.pid`. A live pid alone
// is not enough: after a crash or reboot the OS can reuse it.
async function answersAsDaemon(state: DaemonState): Promise<boolean> {
    try {
        const res = await fetch(`${url(state)}${DAEMON_ROUTE}`, {
            signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
        });
        const body = (await res.json()) as { pid?: number };
        return body.pid === state.pid;
    } catch {
        return false;
    }
}

// Running daemon's state, or undefined. Removes a state file left by a
// daemon that died without cleanup or whose pid was reused.
async function readState(): Promise<DaemonState | undefined> {
    const file = path.join(stateDir(), STATE_FILE);
    let state: DaemonState;
    try {
        state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return undefined;
    }
    if (isAlive(state.pid) && (await answersAsDaemon(state))) return state;
    fs.rmSync(file, { force: true });
    return undefined;
}

// Writes the state file only if none exists, so of two concurrent `run`s
// exactly one runs. Retries once after clearing stale state.
async function claimState(state: DaemonState): Promise<boolean> {
    const file = path.join(stateDir(), STATE_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(file, JSON.stringify(state) + "\n", {
                flag: "wx",
            });
            return true;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            if (await readState()) return false;
        }
    }
    return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const url = (s: DaemonState) => `http://127.0.0.1:${s.port}`;

async function start(): Promise<void> {
    const running = await readState();
    if (running) {
        process.stdout.write(
            `Already running (pid ${running.pid}) at ${url(running)}\n`,
        );
        return;
    }
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const log = fs.openSync(path.join(dir, LOG_FILE), "a");
    // cwd is the state dir so the daemon never holds a project directory
    // open (Windows cannot delete a directory that is some process's cwd).
    // windowsHide: no console window on Windows.
    const child = spawn(process.execPath, [CLI, "daemon", "run"], {
        cwd: dir,
        detached: true,
        stdio: ["ignore", log, log],
        windowsHide: true,
    });
    child.unref();
    fs.closeSync(log);
    // Wait for `run` to write its state; fail fast if it exits first.
    let exited = false;
    child.once("exit", () => (exited = true));
    for (let t = 0; t < START_TIMEOUT_MS && !exited; t += POLL_MS) {
        const state = await readState();
        if (state && state.pid === child.pid) {
            process.stdout.write(
                `Started (pid ${state.pid}) at ${url(state)}\n`,
            );
            return;
        }
        await sleep(POLL_MS);
    }
    // The child exits when a concurrent start won.
    const winner = await readState();
    if (winner) {
        process.stdout.write(
            `Already running (pid ${winner.pid}) at ${url(winner)}\n`,
        );
        return;
    }
    if (!exited) child.kill();
    process.stderr.write(
        `Failed to start daemon, see ${path.join(dir, LOG_FILE)}\n`,
    );
    process.exitCode = 1;
}

async function stop(): Promise<void> {
    const state = await readState();
    if (!state) {
        process.stdout.write("Not running\n");
        return;
    }
    // SIGTERM runs `run`'s cleanup on macOS/Linux. Windows has no signals:
    // Node terminates the process, and the next readState drops the stale file.
    process.kill(state.pid, "SIGTERM");
    for (let t = 0; t < STOP_TIMEOUT_MS; t += POLL_MS) {
        if (!isAlive(state.pid)) {
            fs.rmSync(path.join(stateDir(), STATE_FILE), { force: true });
            process.stdout.write(`Stopped (pid ${state.pid})\n`);
            return;
        }
        await sleep(POLL_MS);
    }
    process.stderr.write(`Daemon (pid ${state.pid}) did not stop\n`);
    process.exitCode = 1;
}

// Foreground server. `start` runs this detached. Writes the state file once
// listening, removes it on SIGTERM/SIGINT.
async function run(): Promise<void> {
    const file = path.join(stateDir(), STATE_FILE);
    const { server, port } = await startServer();
    const state: DaemonState = { pid: process.pid, port };
    if (!(await claimState(state))) {
        process.stderr.write("Another daemon is already running\n");
        server.close();
        process.exitCode = 1;
        return;
    }
    process.stdout.write(`Listening at ${url(state)}\n`);
    const shutdown = () => {
        fs.rmSync(file, { force: true });
        server.close(() => process.exit(0));
        // Do not wait on keep-alive connections.
        server.closeAllConnections();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
}

// `daemon`: manages the per-user HTTP API server.
export const daemonCommand = new Command("daemon").description(
    "Manage the git-story API server shared by all projects",
);

daemonCommand.command("start").description("Start the daemon").action(start);

daemonCommand.command("stop").description("Stop the daemon").action(stop);

daemonCommand
    .command("restart")
    .description("Restart the daemon")
    .action(async () => {
        await stop();
        if (!process.exitCode) await start();
    });

daemonCommand
    .command("status")
    .description("Show whether the daemon is running")
    .action(async () => {
        const state = await readState();
        process.stdout.write(
            state
                ? `Running (pid ${state.pid}) at ${url(state)}\n`
                : "Not running\n",
        );
    });

daemonCommand
    .command("run", { hidden: true })
    .description("Run the server in the foreground")
    .action(run);
