// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { DAEMON_PORT } from "./daemonApi.js";
import { copilotHome, loadDaemonDependencies } from "./daemonComposition.js";
import { DaemonSessions } from "./daemonSessions.js";
import {
    daemonStateDirectory,
    removeOwnedFile,
    writePrivateJson,
} from "./daemonState.js";
import { daemonLogger } from "./logger.js";
import { startServer } from "./server/server.js";

function integerSetting(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const value =
        process.env[name] === undefined ? fallback : Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new Error("Invalid daemon startup configuration");
    return value;
}

export async function runDaemon(): Promise<void> {
    const directory = daemonStateDirectory();
    const stateFile = path.join(directory, "daemon.json");
    const lockFile = path.join(directory, "daemon.lock");
    const token = randomBytes(32).toString("hex");
    let owned = false;
    let server: Server | undefined;
    let sessions: DaemonSessions | undefined;
    let shutdown: Promise<void> | undefined;
    const cleanup = () => {
        removeOwnedFile(stateFile, token);
        removeOwnedFile(lockFile, token);
    };
    const stop = () => {
        shutdown ??= (async () => {
            let failed = false;
            try {
                await sessions?.stop();
            } catch {
                failed = true;
                daemonLogger.error("Session Watcher shutdown reporting failed");
            }
            // Defer close until the stop request's accepted response is sent.
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (server) {
                await new Promise<void>((resolve, reject) => {
                    server!.close((error) =>
                        error ? reject(error) : resolve(),
                    );
                    server!.closeIdleConnections();
                });
            }
            cleanup();
            process.exitCode = failed ? 1 : 0;
        })().catch(() => {
            daemonLogger.error(
                "Daemon shutdown failed; ownership state retained",
            );
            process.exitCode = 1;
        });
    };
    try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        // No automatic stale-lock removal: a hung or PID-reused owner must not
        // be displaced. A crash requires authenticated/offline operator recovery.
        const fd = fs.openSync(lockFile, "wx", 0o600);
        owned = true;
        try {
            fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        const dependencies = await loadDaemonDependencies(
            process.env.GIT_STORY_ADAPTER,
        );
        sessions = new DaemonSessions({
            stateDirectory: directory,
            copilotHome: copilotHome(),
            ...(dependencies ? { dependencies } : {}),
            maxRecords: integerSetting("GIT_STORY_MAX_RECORDS", 1000, 1, 1000),
        });
        server = await startServer(
            integerSetting("GIT_STORY_PORT", DAEMON_PORT, 0, 65535),
            {
                token,
                sessions,
                stop,
            },
        );
        const address = server.address();
        if (!address || typeof address === "string") throw new Error();
        writePrivateJson(stateFile, {
            pid: process.pid,
            port: address.port,
            token,
        });
        daemonLogger.info("Daemon listening on loopback");
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    } catch {
        daemonLogger.error("Daemon startup failed");
        if (sessions)
            await sessions.stop().catch(() => {
                daemonLogger.error("Session Watcher startup cleanup failed");
            });
        server?.close();
        if (owned) cleanup();
        process.exitCode = 1;
    }
}
