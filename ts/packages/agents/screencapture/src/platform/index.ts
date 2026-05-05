// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { WindowInfo } from "./windowEnumerator.js";
import { which } from "./ffmpeg.js";

export type { WindowInfo } from "./windowEnumerator.js";

export interface PlatformBackend {
    enumerateWindows(): Promise<WindowInfo[]>;
    buildScreenshotArgs(
        target: WindowInfo | null,
        outPath: string,
    ): Promise<string[]>;
    buildRecordArgs(
        target: WindowInfo | null,
        outPath: string,
    ): Promise<string[]>;
    // Extra CLI tools (besides ffmpeg) the backend needs on PATH.
    requiredTools: string[];
    // File extensions to use when generating output paths.
    extensions: { screenshot: string; recording: string };
}

export type PlatformResolution =
    | { ok: true; backend: PlatformBackend; platformName: "windows" | "linux" }
    | { ok: false; reason: string };

export async function resolvePlatform(): Promise<PlatformResolution> {
    if (process.platform === "win32") {
        const { windowsBackend } = await import("./windows.js");
        return { ok: true, backend: windowsBackend, platformName: "windows" };
    }
    if (process.platform === "linux") {
        if (process.env.XDG_SESSION_TYPE === "wayland") {
            return {
                ok: false,
                reason: "Wayland sessions are not supported in this version of the screen capture agent. Switch to an X11 session at the login screen and try again.",
            };
        }
        const { linuxBackend } = await import("./linux.js");
        return { ok: true, backend: linuxBackend, platformName: "linux" };
    }
    return {
        ok: false,
        reason: `The screen capture agent does not support platform "${process.platform}". Supported: Windows and Linux (X11).`,
    };
}

// Reports the first missing tool, or undefined if all required tools are
// available. Used to produce a single, actionable install hint at runtime.
export async function findMissingTool(
    tools: string[],
): Promise<string | undefined> {
    for (const tool of tools) {
        const path = await which(tool);
        if (path === undefined) {
            return tool;
        }
    }
    return undefined;
}

export function toolInstallHint(tool: string): string {
    if (process.platform === "linux") {
        const map: Record<string, string> = {
            wmctrl: "Install wmctrl with `sudo apt install wmctrl` (or your distro's equivalent).",
            xdotool:
                "Install xdotool with `sudo apt install xdotool` (or your distro's equivalent).",
        };
        return (
            map[tool] ??
            `Install \`${tool}\` from your distribution's package manager.`
        );
    }
    return `\`${tool}\` is required but was not found on PATH.`;
}
