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

// Sentinel thrown by syncNow() when the helper exe hasn't been built yet.
// The agent's sync command catches this specifically to offer to build it,
// rather than parsing the error message.
export class HelperNotBuiltError extends Error {
    public readonly _osNotificationsHelperNotBuilt = true as const;
    constructor(message: string) {
        super(message);
        this.name = "HelperNotBuiltError";
    }
}

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
        return {
            async stop() {},
            async syncNow() {
                throw new HelperNotBuiltError(
                    "OS notification helper exe not found.",
                );
            },
        };
    }

    let stopped = false;
    let restarts = 0;
    let child: ChildProcess | undefined;
    let restartTimer: NodeJS.Timeout | undefined;

    const launch = () => {
        if (stopped) return;
        debug("spawning helper: %s", exePath);
        // stdin is piped so syncNow() can send commands ("sync\n") to the
        // helper. The helper also uses stdin closure as a parent-death signal,
        // so this pipe must stay open for the lifetime of the child.
        child = spawn(exePath, [], {
            stdio: ["pipe", "pipe", "pipe"],
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
        async syncNow(): Promise<void> {
            if (stopped || child === undefined || !child.stdin?.writable) {
                throw new Error(
                    "OS notification helper is not running; nothing to sync.",
                );
            }
            // Send the sync command line. The helper enumerates current
            // action-center notifications and emits each as an "added" event
            // with fromSync: true on stdout, which the listener path above
            // already handles.
            await new Promise<void>((resolve, reject) => {
                child!.stdin!.write("sync\n", (err) =>
                    err ? reject(err) : resolve(),
                );
            });
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

// Resolves the directory containing the C# helper's .csproj (which is also
// where we want `dotnet publish` to write the output). The postbuild step
// copies bin/** -> dist/bin/**, so the project file is colocated with where
// the exe should land.
function resolveHelperProjectDir(): string | undefined {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(here, "..", "bin", "OsNotificationListener"),
        path.resolve(here, "..", "..", "bin", "OsNotificationListener"),
    ];
    for (const c of candidates) {
        const proj = path.join(c, "OsNotificationListener.csproj");
        if (existsSync(proj)) return c;
    }
    return undefined;
}

// Spawns `dotnet publish` to build the C# helper. Output is published in-place
// (same directory as the .csproj) so resolveHelperPath() picks it up next time.
// onProgress is invoked with each stdout/stderr line as the build runs — pipe
// it to actionIO.appendDisplay for live progress in chat.
export async function buildWindowsHelper(opts: {
    onProgress?: (line: string) => void;
}): Promise<void> {
    const projDir = resolveHelperProjectDir();
    if (projDir === undefined) {
        throw new Error(
            "OS notification helper source (OsNotificationListener.csproj) not found. The agent's package may be incomplete.",
        );
    }
    return new Promise<void>((resolve, reject) => {
        const args = [
            "publish",
            "-c",
            "Release",
            "-r",
            "win-x64",
            "-o",
            projDir,
        ];
        const child = spawn("dotnet", args, {
            cwd: projDir,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
        });

        // Per-stream line buffer so onProgress sees one full line at a time
        // even when chunks split mid-line.
        const buffers = { stdout: "", stderr: "" };
        const onChunk = (chunk: string, stream: "stdout" | "stderr") => {
            buffers[stream] += chunk;
            let nl: number;
            while ((nl = buffers[stream].indexOf("\n")) !== -1) {
                const line = buffers[stream].slice(0, nl).replace(/\r$/, "");
                buffers[stream] = buffers[stream].slice(nl + 1);
                if (line.length > 0) {
                    opts.onProgress?.(`[${stream}] ${line}`);
                }
            }
        };
        child.stdout!.setEncoding("utf8");
        child.stderr!.setEncoding("utf8");
        child.stdout!.on("data", (c: string) => onChunk(c, "stdout"));
        child.stderr!.on("data", (c: string) => onChunk(c, "stderr"));

        child.on("error", (e) => {
            // Most common error here is "dotnet not found on PATH" — surface
            // it specifically so the user knows what to install.
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                reject(
                    new Error(
                        "`dotnet` command not found. Install the .NET 8 SDK and ensure dotnet is on PATH.",
                    ),
                );
            } else {
                reject(e);
            }
        });
        child.on("exit", (code, signal) => {
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `dotnet publish exited with code=${code} signal=${signal}`,
                    ),
                );
        });
    });
}
