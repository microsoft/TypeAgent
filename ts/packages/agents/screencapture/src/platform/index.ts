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

export type PlatformSupport =
    | {
          supported: true;
          platformName: "windows" | "linux";
          // Extra CLI tools (besides ffmpeg) the platform needs on PATH.
          extraTools: string[];
      }
    | { supported: false; reason: string };

// Pure decision: does this (platform, session-type) combination support the
// screen capture agent, and if so, what extra CLI tools does it need? Split
// out from resolvePlatform so the readiness check (and unit tests) can run
// without dynamically importing the heavyweight backend modules.
export function describePlatformSupport(
    platform: NodeJS.Platform,
    xdgSessionType: string | undefined,
): PlatformSupport {
    if (platform === "win32") {
        return { supported: true, platformName: "windows", extraTools: [] };
    }
    if (platform === "linux") {
        if (xdgSessionType === "wayland") {
            return {
                supported: false,
                reason: "Wayland sessions are not supported in this version of the screen capture agent. Switch to an X11 session at the login screen and try again.",
            };
        }
        return {
            supported: true,
            platformName: "linux",
            extraTools: ["wmctrl", "xdotool"],
        };
    }
    return {
        supported: false,
        reason: `The screen capture agent does not support platform "${platform}". Supported: Windows and Linux (X11).`,
    };
}

export type PlatformResolution =
    | { ok: true; backend: PlatformBackend; platformName: "windows" | "linux" }
    | { ok: false; reason: string };

export async function resolvePlatform(): Promise<PlatformResolution> {
    const support = describePlatformSupport(
        process.platform,
        process.env.XDG_SESSION_TYPE,
    );
    if (!support.supported) {
        return { ok: false, reason: support.reason };
    }
    if (support.platformName === "windows") {
        const { windowsBackend } = await import("./windows.js");
        return { ok: true, backend: windowsBackend, platformName: "windows" };
    }
    const { linuxBackend } = await import("./linux.js");
    return { ok: true, backend: linuxBackend, platformName: "linux" };
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

// Multi-tool install guidance for the readiness `details` field. Per-platform
// so the user gets a copy-pasteable command for their distribution.
export function installDetailsFor(
    platformName: "windows" | "linux",
    missingTools: string[],
): string {
    if (missingTools.length === 0) return "";
    if (platformName === "windows") {
        // Only ffmpeg can be missing on Windows (extraTools is []).
        return "Install ffmpeg with `winget install Gyan.FFmpeg` (or download from https://ffmpeg.org), then run `@config agent refresh screencapture`.";
    }
    // Linux — bucket what package managers each tool typically lives in.
    const aptPkgs = missingTools
        .map((t) => (t === "ffmpeg" ? "ffmpeg" : t))
        .join(" ");
    return [
        `Install the missing tools, then run \`@config agent refresh screencapture\`:`,
        `  - Debian/Ubuntu: \`sudo apt install ${aptPkgs}\``,
        `  - Fedora: \`sudo dnf install ${aptPkgs}\``,
        `  - Arch: \`sudo pacman -S ${aptPkgs}\``,
    ].join("\n");
}
