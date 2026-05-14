// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "child_process";

// Locates an external CLI tool by querying PATH. Returns the resolved path,
// or undefined if not found.
export async function which(tool: string): Promise<string | undefined> {
    const cmd = process.platform === "win32" ? "where" : "which";
    return new Promise((resolve) => {
        let stdout = "";
        const child = spawn(cmd, [tool], {
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.on("close", (code) => {
            if (code !== 0) {
                resolve(undefined);
                return;
            }
            const firstLine = stdout
                .split(/\r?\n/)
                .map((l) => l.trim())
                .find((l) => l.length > 0);
            resolve(firstLine);
        });
        child.on("error", () => resolve(undefined));
    });
}

export type FfmpegStatus =
    | { found: true; path: string }
    | { found: false; installHint: string };

export function ffmpegInstallHint(): string {
    if (process.platform === "win32") {
        return "ffmpeg not found on PATH. Install it with `winget install Gyan.FFmpeg` (or download from https://ffmpeg.org), then restart the agent.";
    }
    return "ffmpeg not found on PATH. Install it with one of:\n  - Debian/Ubuntu: `sudo apt install ffmpeg`\n  - Fedora: `sudo dnf install ffmpeg`\n  - Arch: `sudo pacman -S ffmpeg`\nThen restart the agent.";
}

export async function detectFfmpeg(): Promise<FfmpegStatus> {
    const found = await which("ffmpeg");
    if (found) {
        return { found: true, path: found };
    }
    return { found: false, installHint: ffmpegInstallHint() };
}
