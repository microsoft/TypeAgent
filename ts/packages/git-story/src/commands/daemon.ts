// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { daemonClient, GitStoryDaemonClient } from "../daemonClient.js";
import {
    daemonStateDirectory,
    readDaemonState,
    type DaemonState,
} from "../daemonState.js";
import { daemonLogger } from "../logger.js";

const DAEMON_MAIN = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../daemonMain.js",
);
const url = (state: DaemonState) => `http://127.0.0.1:${state.port}`;
const clientFor = (state: DaemonState) =>
    new GitStoryDaemonClient(state.port, 2000, state.token);

async function running(): Promise<DaemonState | undefined> {
    const state = readDaemonState();
    if (!state) return undefined;
    try {
        return (await clientFor(state).identity()).pid === state.pid
            ? state
            : undefined;
    } catch {
        return undefined;
    }
}

async function start(): Promise<void> {
    const current = await running();
    if (current) {
        process.stdout.write(
            `Already running (pid ${current.pid}) at ${url(current)}\n`,
        );
        return;
    }
    const directory = daemonStateDirectory();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const logFile = daemonLogger.file();
    fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
    const log = fs.openSync(logFile, "a", 0o600);
    // Inherit explicit local adapter/state settings, never credentials in argv.
    const child = spawn(process.execPath, [DAEMON_MAIN], {
        cwd: directory,
        detached: true,
        stdio: ["ignore", log, log],
        windowsHide: true,
    });
    let exited = false;
    child.once("exit", () => {
        exited = true;
    });
    child.once("error", () => {
        exited = true;
    });
    child.unref();
    fs.closeSync(log);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const state = await running();
        if (state) {
            process.stdout.write(
                `${state.pid === child.pid ? "Started" : "Already running"} (pid ${state.pid}) at ${url(state)}\n`,
            );
            return;
        }
        await sleep(50);
    }
    const winner = await running();
    if (winner) {
        process.stdout.write(
            `Already running (pid ${winner.pid}) at ${url(winner)}\n`,
        );
        return;
    }
    process.stderr.write(
        exited
            ? "Daemon failed to start; inspect the local daemon log. An abandoned daemon.lock requires deliberate offline cleanup.\n"
            : "Daemon startup is still pending; inspect status and the local daemon log. No process was killed.\n",
    );
    process.exitCode = 1;
}

async function stop(): Promise<void> {
    const state = await running();
    if (!state) {
        process.stdout.write(
            "Not running (no authenticated owner responded)\n",
        );
        return;
    }
    await clientFor(state).stop();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const current = readDaemonState();
        if (!current || current.token !== state.token) {
            process.stdout.write(
                `Stopped (pid ${state.pid}); admitted work drained\n`,
            );
            return;
        }
        await sleep(50);
    }
    process.stderr.write(
        "Daemon is still stopping; no process was killed or ownership state removed. Check status again.\n",
    );
    process.exitCode = 1;
}

// Avoid displaying dependency, filesystem, or transport errors that can contain
// credentials or transcript content. Operational detail is available in receipts.
const action = (run: () => Promise<void>) => async () => {
    try {
        await run();
    } catch {
        process.stderr.write(
            "Daemon command failed; inspect local ownership and authenticated session status.\n",
        );
        process.exitCode = 1;
    }
};

export const daemonCommand = new Command("daemon").description(
    "Manage the per-user git-story daemon",
);
daemonCommand.command("start").action(action(start));
daemonCommand.command("stop").action(action(stop));
daemonCommand.command("restart").action(
    action(async () => {
        await stop();
        if (!process.exitCode) await start();
    }),
);
daemonCommand.command("status").action(
    action(async () => {
        const state = await running();
        process.stdout.write(
            state
                ? JSON.stringify({
                      ...(await clientFor(state).identity()),
                      url: url(state),
                  }) + "\n"
                : "Not running\n",
        );
    }),
);
daemonCommand
    .command("sessions")
    .description("Show local operational receipts, without payloads")
    .action(
        action(async () => {
            process.stdout.write(
                JSON.stringify(await daemonClient.sessions(), null, 2) + "\n",
            );
        }),
    );
daemonCommand
    .command("register")
    .argument("<project>", "absolute project directory")
    .argument("<session>", "Copilot session ID")
    .action(async (projectPath: string, sessionId: string) =>
        action(async () => {
            const receipt = await daemonClient.registerSession({
                projectPath,
                sessionId,
                metadata: { clientName: "copilot-cli", models: [] },
            });
            process.stdout.write(JSON.stringify(receipt) + "\n");
        })(),
    );
