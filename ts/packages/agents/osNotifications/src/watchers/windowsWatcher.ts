// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import registerDebug from "debug";
import type {
    OsNotificationEvent,
    OsNotificationListener,
    OsNotificationWatcher,
} from "../watcherProtocol.js";

const debug = registerDebug("typeagent:osNotifications:windows");

// Restart backoff. Capped to avoid hot-looping on a permanently-broken
// helper (e.g. WinRT capability denied).
const RESTART_BASE_MS = 500;
const RESTART_MAX_MS = 30_000;
const RESTART_GIVE_UP_AFTER = 5;

// Spawns the bundled OsNotificationListener.exe helper. The helper subscribes
// to Windows.UI.Notifications.Management.UserNotificationListener and writes
// JSON-per-line on stdout in the OsNotificationEvent shape from
// watcherProtocol.ts.
//
// IMPORTANT — packaging caveat: UserNotificationListener historically required
// UWP package identity to function. From a plain unpackaged Node host this
// API may return AccessStatus.Denied at runtime depending on Windows build.
// The helper emits a kind:"error" event in that case; the agent surfaces it
// once and stops trying.
export function startWindowsWatcher(
    listener: OsNotificationListener,
): OsNotificationWatcher {
    const exePath = resolveHelperPath();
    if (exePath === undefined) {
        listener({
            kind: "error",
            message:
                "OS notification helper exe not found. Build it with `dotnet publish` from packages/agents/osNotifications/bin/OsNotificationListener and place the output in dist/bin/OsNotificationListener/.",
        });
        return { async stop() {} };
    }

    let stopped = false;
    let restarts = 0;
    let child: ChildProcess | undefined;
    let restartTimer: NodeJS.Timeout | undefined;

    const launch = () => {
        if (stopped) return;
        debug("spawning helper: %s", exePath);
        child = spawn(exePath, [], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        let stdoutBuf = "";
        child.stdout!.setEncoding("utf8");
        child.stdout!.on("data", (chunk: string) => {
            stdoutBuf += chunk;
            let nl: number;
            while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
                const line = stdoutBuf.slice(0, nl).trim();
                stdoutBuf = stdoutBuf.slice(nl + 1);
                if (line.length === 0) continue;
                try {
                    const evt = JSON.parse(line) as OsNotificationEvent;
                    listener(evt);
                } catch (e: any) {
                    debug("invalid line from helper: %s", line);
                }
            }
        });

        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", (chunk: string) => {
            debug("helper stderr: %s", chunk.trimEnd());
        });

        child.on("exit", (code, signal) => {
            debug("helper exited code=%s signal=%s", code, signal);
            child = undefined;
            if (stopped) return;
            restarts += 1;
            if (restarts > RESTART_GIVE_UP_AFTER) {
                listener({
                    kind: "error",
                    message: `OS notification helper kept crashing (${restarts} restarts). Giving up — see DEBUG=typeagent:osNotifications:windows for details.`,
                });
                return;
            }
            const delay = Math.min(
                RESTART_BASE_MS * 2 ** (restarts - 1),
                RESTART_MAX_MS,
            );
            restartTimer = setTimeout(launch, delay);
        });

        child.on("error", (e) => {
            debug("helper spawn error: %s", e.message);
        });
    };

    launch();

    return {
        async stop() {
            stopped = true;
            if (restartTimer) clearTimeout(restartTimer);
            if (child) {
                try {
                    child.kill();
                } catch {
                    // best effort
                }
            }
        },
    };
}

function resolveHelperPath(): string | undefined {
    // After build, postbuild copies bin/** -> dist/bin/**, and this module is
    // in dist/watchers/. Resolve relative to import.meta.url.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(
            here,
            "..",
            "bin",
            "OsNotificationListener",
            "OsNotificationListener.exe",
        ),
        path.resolve(
            here,
            "..",
            "..",
            "bin",
            "OsNotificationListener",
            "OsNotificationListener.exe",
        ),
    ];
    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    return undefined;
}
