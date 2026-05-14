// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "child_process";
import { readFile } from "fs/promises";
import type { PlatformBackend } from "./index.js";
import type { WindowInfo } from "./windowEnumerator.js";

function runCommand(
    cmd: string,
    args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const child = spawn(cmd, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) =>
            resolve({ code: code ?? -1, stdout, stderr }),
        );
    });
}

async function readProcessName(pid: string): Promise<string> {
    try {
        const comm = await readFile(`/proc/${pid}/comm`, "utf8");
        return comm.trim();
    } catch {
        return "";
    }
}

// wmctrl -lp output: <hex-window-id> <desktop> <pid> <host> <title rest-of-line>
async function enumerateWindows(): Promise<WindowInfo[]> {
    const { code, stdout, stderr } = await runCommand("wmctrl", ["-lp"]);
    if (code !== 0) {
        throw new Error(`wmctrl -lp failed: ${stderr.trim() || stdout.trim()}`);
    }
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const out: WindowInfo[] = [];
    for (const line of lines) {
        // Five whitespace-separated fields, with the title being the trailing
        // remainder. Splitting on /\s+/ with a limit eats internal spaces in
        // the title, so split manually.
        const match = line.match(
            /^(0x[0-9a-fA-F]+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/,
        );
        if (!match) continue;
        const [, id, , pid, , title] = match;
        const processName = await readProcessName(pid);
        out.push({ id, title, processName });
    }
    return out;
}

type Geometry = { x: number; y: number; width: number; height: number };

async function getWindowGeometry(windowId: string): Promise<Geometry> {
    // xdotool accepts both decimal and 0x-prefixed window ids.
    const { code, stdout, stderr } = await runCommand("xdotool", [
        "getwindowgeometry",
        "--shell",
        windowId,
    ]);
    if (code !== 0) {
        throw new Error(`xdotool failed for ${windowId}: ${stderr.trim()}`);
    }
    const env: Record<string, string> = {};
    for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^(\w+)=(.*)$/);
        if (m) env[m[1]] = m[2];
    }
    const x = Number(env.X);
    const y = Number(env.Y);
    const width = Number(env.WIDTH);
    const height = Number(env.HEIGHT);
    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
    ) {
        throw new Error(
            `xdotool returned invalid geometry for ${windowId}: ${stdout}`,
        );
    }
    return { x, y, width, height };
}

function display(): string {
    return process.env.DISPLAY ?? ":0";
}

async function targetInputArgs(target: WindowInfo | null): Promise<string[]> {
    if (target === null) {
        return ["-i", display()];
    }
    const g = await getWindowGeometry(target.id);
    // x11grab requires even dimensions for libx264 yuv420p.
    const w = g.width % 2 === 0 ? g.width : g.width - 1;
    const h = g.height % 2 === 0 ? g.height : g.height - 1;
    return ["-video_size", `${w}x${h}`, "-i", `${display()}+${g.x},${g.y}`];
}

async function buildScreenshotArgs(
    target: WindowInfo | null,
    outPath: string,
): Promise<string[]> {
    return [
        "-y",
        "-f",
        "x11grab",
        ...(await targetInputArgs(target)),
        "-frames:v",
        "1",
        outPath,
    ];
}

async function buildRecordArgs(
    target: WindowInfo | null,
    outPath: string,
): Promise<string[]> {
    return [
        "-y",
        "-f",
        "x11grab",
        "-framerate",
        "30",
        ...(await targetInputArgs(target)),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        outPath,
    ];
}

export const linuxBackend: PlatformBackend = {
    enumerateWindows,
    buildScreenshotArgs,
    buildRecordArgs,
    // wmctrl needed for window enumeration; xdotool only needed when
    // the user targets a specific window. Both are reported up front so
    // the install hint is single-shot.
    requiredTools: ["wmctrl", "xdotool"],
    extensions: { screenshot: "png", recording: "mp4" },
};
