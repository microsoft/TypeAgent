// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "child_process";
import type { PlatformBackend } from "./index.js";
import type { WindowInfo } from "./windowEnumerator.js";

const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$procs = Get-Process |
    Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowHandle -ne 0 } |
    Select-Object Id, ProcessName, MainWindowTitle
ConvertTo-Json -InputObject @($procs) -Compress
`;

async function enumerateWindows(): Promise<WindowInfo[]> {
    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const child = spawn(
            "powershell",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                POWERSHELL_SCRIPT,
            ],
            { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
        );
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `Get-Process failed (code ${code}): ${stderr.trim()}`,
                    ),
                );
                return;
            }
            const trimmed = stdout.trim();
            if (trimmed === "" || trimmed === "[]") {
                resolve([]);
                return;
            }
            try {
                const parsed = JSON.parse(trimmed);
                const list = Array.isArray(parsed) ? parsed : [parsed];
                resolve(
                    list.map((p) => ({
                        id: String(p.Id),
                        title: String(p.MainWindowTitle ?? ""),
                        processName: String(p.ProcessName ?? ""),
                    })),
                );
            } catch (e: any) {
                reject(new Error(`Failed to parse process list: ${e.message}`));
            }
        });
    });
}

// gdigrab accepts `title=<exact window title>` as input.
// Passing it as a single spawn argument avoids any shell-quoting issues.
function inputForTarget(target: WindowInfo | null): string[] {
    return target === null
        ? ["-i", "desktop"]
        : ["-i", `title=${target.title}`];
}

async function buildScreenshotArgs(
    target: WindowInfo | null,
    outPath: string,
): Promise<string[]> {
    return [
        "-y",
        "-f",
        "gdigrab",
        ...inputForTarget(target),
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
        "gdigrab",
        "-framerate",
        "30",
        ...inputForTarget(target),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        outPath,
    ];
}

export const windowsBackend: PlatformBackend = {
    enumerateWindows,
    buildScreenshotArgs,
    buildRecordArgs,
    requiredTools: [],
    extensions: { screenshot: "png", recording: "mp4" },
};
