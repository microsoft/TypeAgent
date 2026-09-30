// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server/server.js";

// One daemon per repository. Its state lives in the git dir, so worktrees of
// one clone share it and nothing shows up in `git status`.
//
//   git story daemon start
//     └─ spawns detached `git-story daemon run` (cwd = repo root)
//          └─ listens on 127.0.0.1:<free port>
//          └─ writes .git/git-story/daemon.json {"pid":4242,"port":51234}
//   git story daemon status  -> reads daemon.json, checks pid is alive
//   git story daemon stop    -> SIGTERM pid; `run` deletes daemon.json on exit
const STATE_DIR = "git-story";
const STATE_FILE = "daemon.json";
const LOG_FILE = "daemon.log";
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;
const POLL_MS = 50;

type DaemonState = { pid: number; port: number };

const CLI = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../cli.js",
);

const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();

// Absolute state dir, e.g. /repo/.git/git-story. `--git-common-dir` is
// relative to the cwd, so resolve it.
function stateDir(): string {
    return path.join(
        path.resolve(git("rev-parse", "--git-common-dir")),
        STATE_DIR,
    );
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM: the process exists but belongs to another user.
        return (e as NodeJS.ErrnoException).code === "EPERM";
    }
}

// Running daemon's state, or undefined. Removes a state file left by a
// daemon that died without cleanup.
function readState(): DaemonState | undefined {
    const file = path.join(stateDir(), STATE_FILE);
    let state: DaemonState;
    try {
        state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return undefined;
    }
    if (isAlive(state.pid)) return state;
    fs.rmSync(file, { force: true });
    return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const url = (s: DaemonState) => `http://127.0.0.1:${s.port}`;

async function start(): Promise<void> {
    const running = readState();
    if (running) {
        process.stdout.write(
            `Already running (pid ${running.pid}) at ${url(running)}\n`,
        );
        return;
    }
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const log = fs.openSync(path.join(dir, LOG_FILE), "a");
    const child = spawn(process.execPath, [CLI, "daemon", "run"], {
        cwd: git("rev-parse", "--show-toplevel"),
        detached: true,
        stdio: ["ignore", log, log],
    });
    child.unref();
    fs.closeSync(log);
    // Wait for `run` to write its state; fail fast if it exits first.
    let exited = false;
    child.once("exit", () => (exited = true));
    for (let t = 0; t < START_TIMEOUT_MS && !exited; t += POLL_MS) {
        const state = readState();
        if (state && state.pid === child.pid) {
            process.stdout.write(
                `Started (pid ${state.pid}) at ${url(state)}\n`,
            );
            return;
        }
        await sleep(POLL_MS);
    }
    if (!exited) child.kill();
    process.stderr.write(
        `Failed to start daemon, see ${path.join(dir, LOG_FILE)}\n`,
    );
    process.exitCode = 1;
}

async function stop(): Promise<void> {
    const state = readState();
    if (!state) {
        process.stdout.write("Not running\n");
        return;
    }
    process.kill(state.pid, "SIGTERM");
    for (let t = 0; t < STOP_TIMEOUT_MS; t += POLL_MS) {
        if (!isAlive(state.pid)) {
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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state) + "\n");
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

// `daemon`: manages the per-repository HTTP API server.
export const daemonCommand = new Command("daemon").description(
    "Manage the git-story API server for this repository",
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
    .action(() => {
        const state = readState();
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
