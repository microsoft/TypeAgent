// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, ChildProcess } from "child_process";
import registerDebug from "debug";

const debug = registerDebug("typeagent:screencapture:proc");

export type SpawnedRecording = {
    child: ChildProcess;
    exit: Promise<{ code: number | null; stderr: string }>;
};

// Spawns ffmpeg as a long-lived child suitable for graceful stop via stdin.
// stdin is kept open so we can write "q\n" to ask ffmpeg to finalize the
// output container before exit (more reliable than SIGINT on Windows).
export function spawnRecording(
    ffmpegPath: string,
    args: string[],
): SpawnedRecording {
    debug("spawning ffmpeg", ffmpegPath, args.join(" "));
    const child = spawn(ffmpegPath, args, {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
    });

    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString();
        if (stderr.length > 64 * 1024) {
            stderr = stderr.slice(-64 * 1024);
        }
    });

    const exit = new Promise<{ code: number | null; stderr: string }>(
        (resolve, reject) => {
            child.on("close", (code) => resolve({ code, stderr }));
            child.on("error", reject);
        },
    );

    return { child, exit };
}

// Asks ffmpeg to stop gracefully. Escalates to SIGTERM, then SIGKILL if it
// doesn't exit within the timeouts. Returns the final exit code (or null).
export async function stopRecording(
    rec: SpawnedRecording,
    gracefulTimeoutMs = 5000,
    termTimeoutMs = 3000,
): Promise<{ code: number | null; stderr: string }> {
    if (rec.child.exitCode !== null) {
        return rec.exit;
    }
    try {
        rec.child.stdin?.write("q\n");
        rec.child.stdin?.end();
    } catch (e: any) {
        debug("stdin write failed:", e.message);
    }

    const graceful = await raceWithTimeout(rec.exit, gracefulTimeoutMs);
    if (graceful !== "timeout") {
        return graceful;
    }
    debug("graceful stop timed out, sending SIGTERM");
    rec.child.kill("SIGTERM");

    const term = await raceWithTimeout(rec.exit, termTimeoutMs);
    if (term !== "timeout") {
        return term;
    }
    debug("SIGTERM timed out, sending SIGKILL");
    rec.child.kill("SIGKILL");
    return rec.exit;
}

async function raceWithTimeout<T>(
    p: Promise<T>,
    ms: number,
): Promise<T | "timeout"> {
    return Promise.race<T | "timeout">([
        p,
        new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), ms),
        ),
    ]);
}

// Run ffmpeg for a one-shot operation (e.g. screenshot) and wait for exit.
export function runOnce(
    ffmpegPath: string,
    args: string[],
): Promise<{ code: number | null; stderr: string }> {
    const rec = spawnRecording(ffmpegPath, args);
    rec.child.stdin?.end();
    return rec.exit;
}
