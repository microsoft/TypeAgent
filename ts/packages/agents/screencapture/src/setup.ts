// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Setup pipeline for the screencapture agent. Best-effort installer that
// runs winget on Windows and `sudo -n apt-get install` on Linux. Manual
// install (with platform-specific hints from installDetailsFor) remains
// the fallback whenever an installer isn't available or sudo would prompt.
//
// The pipeline is split:
//   - planSetupCommand — pure decision function (unit-testable)
//   - runSetup        — async; probes installer availability, calls
//                       planSetupCommand, spawns the install, streams
//                       progress via actionContext.actionIO.

import { spawn } from "child_process";
import { which } from "./platform/ffmpeg.js";

// Winget package IDs for tools we know how to install on Windows. Only
// ffmpeg is Windows-installable today (no wmctrl/xdotool on Windows —
// extraTools is empty in describePlatformSupport for win32).
//
// `Gyan.FFmpeg.Essentials` (vs `Gyan.FFmpeg`):
//   - Smaller download (~80MB vs ~240MB) — faster install in chat.
//   - Includes ffmpeg.exe + ffprobe.exe (no ffplay) — sufficient; the
//     screencapture agent only spawns ffmpeg.
//   - Avoids the recurring winget manifest bug on `Gyan.FFmpeg` where
//     the post-extract install step fails with "Nested installer file
//     does not exist" because the upstream archive's inner folder name
//     drifted and the manifest hadn't been updated to match.
const WINGET_IDS: Record<string, string> = {
    ffmpeg: "Gyan.FFmpeg.Essentials",
};

export type SetupCommand = {
    // Human-readable label shown to the user before spawn.
    description: string;
    argv: string[];
};

export type SetupPlan =
    | { kind: "ok"; commands: SetupCommand[] }
    | { kind: "error"; message: string };

export type LinuxInstallerProbe = {
    aptPresent: boolean;
    sudoNoninteractiveOk: boolean;
};

// Pure decision: given a target platform and a list of missing tools, return
// the install commands to run (or an explanation of why we can't help). All
// platform/availability knowledge enters via parameters so the function can
// be exercised in tests without spawning subprocesses.
export function planSetupCommand(
    platformName: "windows" | "linux",
    missing: string[],
    availability: {
        wingetPresent?: boolean;
        linux?: LinuxInstallerProbe;
    },
): SetupPlan {
    if (missing.length === 0) {
        return { kind: "ok", commands: [] };
    }
    if (platformName === "windows") {
        if (!availability.wingetPresent) {
            return {
                kind: "error",
                message:
                    "winget is not available on this machine. Install ffmpeg manually (see https://ffmpeg.org), then run `@config agent refresh screencapture`.",
            };
        }
        const commands: SetupCommand[] = [];
        const unknown: string[] = [];
        for (const tool of missing) {
            const id = WINGET_IDS[tool];
            if (id === undefined) {
                unknown.push(tool);
                continue;
            }
            commands.push({
                description: `Installing ${tool} via winget (${id})`,
                argv: [
                    "winget",
                    "install",
                    "--id",
                    id,
                    "--silent",
                    "--scope",
                    "user",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ],
            });
        }
        if (unknown.length > 0) {
            return {
                kind: "error",
                message: `No automated installer mapping for ${unknown.join(", ")} on Windows. Install manually, then run \`@config agent refresh screencapture\`.`,
            };
        }
        return { kind: "ok", commands };
    }
    // Linux — apt-only, best effort.
    const linux = availability.linux;
    if (!linux || !linux.aptPresent) {
        return {
            kind: "error",
            message:
                "Automated install on Linux only supports apt-based distributions. Install the missing tools with your distribution's package manager, then run `@config agent refresh screencapture`.",
        };
    }
    if (!linux.sudoNoninteractiveOk) {
        // sudo -n true failed: either sudo isn't installed, or a password
        // is required. Neither can be answered from a chat prompt — punt
        // to manual install with the same hint installDetailsFor produces.
        return {
            kind: "error",
            message: `Automated install requires passwordless sudo. Run \`sudo apt-get install -y ${missing.join(" ")}\` in a terminal, then \`@config agent refresh screencapture\`.`,
        };
    }
    return {
        kind: "ok",
        commands: [
            {
                description: `Installing ${missing.join(", ")} via apt-get`,
                // sudo -n: never prompt for a password — we already
                // verified passwordless sudo works via probeLinuxInstaller.
                argv: ["sudo", "-n", "apt-get", "install", "-y", ...missing],
            },
        ],
    };
}

// Probes the linux installer environment. Result feeds planSetupCommand.
export async function probeLinuxInstaller(): Promise<LinuxInstallerProbe> {
    const aptPresent = (await which("apt-get")) !== undefined;
    if (!aptPresent) {
        return { aptPresent: false, sudoNoninteractiveOk: false };
    }
    // `sudo -n true` exits 0 only when sudo can proceed without prompting
    // (passwordless sudoers entry, or a fresh credential cache). Anything
    // else means we'd block waiting for a password we can't supply.
    const ok = await new Promise<boolean>((resolve) => {
        const child = spawn("sudo", ["-n", "true"], {
            stdio: ["ignore", "ignore", "ignore"],
        });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
    return { aptPresent, sudoNoninteractiveOk: ok };
}

// True for lines that are pure CLI redraw noise — winget redraws its
// download progress bar with carriage returns; capturing it line-by-line
// turns one bar into dozens of near-identical lines that flood the chat.
// We drop:
//   - empty lines (already filtered upstream, defense-in-depth)
//   - single spinner glyphs (- \ | /)
//   - lines containing the bar glyphs █ or ▒ (with or without size/percent)
// Retained: any line with prose / URLs / errors — those are what the user
// actually wants to see.
//
// Exported for unit tests.
export function isProgressNoise(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) return true;
    if (/^[-\\|/]$/.test(trimmed)) return true;
    if (/[█▒]/.test(trimmed)) return true;
    return false;
}

// Spawn a single setup command, streaming combined stdout/stderr lines via
// the supplied callback. Resolves with { code, tail } so the caller can
// surface a tail of the error output on failure. Progress-bar noise is
// filtered out of the live stream but still kept in the failure tail so
// the buffer reflects what actually came out of the process.
export function runSetupCommand(
    cmd: SetupCommand,
    onLine: (line: string) => void,
): Promise<{ code: number; tail: string }> {
    return new Promise((resolve) => {
        const [bin, ...args] = cmd.argv;
        const child = spawn(bin, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        // Bounded ring buffer of recent lines — surfaced on failure so the
        // user sees the actual error without us streaming an unbounded log
        // back to the chat. Includes progress noise so a failure mid-bar
        // still has surrounding context.
        const recent: string[] = [];
        const push = (chunk: Buffer) => {
            for (const raw of chunk.toString().split(/\r?\n/)) {
                const line = raw.trim();
                if (line.length === 0) continue;
                recent.push(line);
                if (recent.length > 40) recent.shift();
                if (!isProgressNoise(line)) onLine(line);
            }
        };
        child.stdout.on("data", push);
        child.stderr.on("data", push);
        child.on("error", (e) => {
            onLine(`spawn error: ${e.message}`);
            resolve({ code: -1, tail: e.message });
        });
        child.on("close", (code) => {
            resolve({ code: code ?? -1, tail: recent.join("\n") });
        });
    });
}
