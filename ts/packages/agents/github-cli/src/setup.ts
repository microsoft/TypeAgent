// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Setup pipeline for the github-cli agent. Best-effort installer that
// runs `winget install` on Windows and `sudo -n apt-get install` on
// Linux. Mirrors the screencapture agent's setup module — kept parallel
// rather than shared because the install matrix and progress-output
// shape are slightly different per agent. If a third agent needs the
// same pattern, extract a shared utility.
//
// gh on Linux: the official GitHub install docs add a keyring + apt
// repo before `apt install gh` on most distros (the package isn't in
// stock Ubuntu/Debian repos by default). We don't try to add the repo
// on the user's behalf — that's a multi-step sudo flow involving curl,
// gpg, and tee that we'd rather not script. We DO best-effort an
// apt-get install in case the user has already added the repo or is on
// a distro that ships gh natively. If that fails, the failure tail is
// surfaced verbatim and the manual-install hint points the user at
// https://github.com/cli/cli/blob/trunk/docs/install_linux.md.

import { spawn } from "child_process";

export type SetupCommand = {
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

// Pure decision: given a target platform and availability inputs, return
// the install commands or an explanation of why we can't help. Pure so
// it can be unit-tested without spawning subprocesses.
export function planGhSetupCommand(
    platformName: "windows" | "linux",
    availability: {
        wingetPresent?: boolean;
        linux?: LinuxInstallerProbe;
    },
): SetupPlan {
    if (platformName === "windows") {
        if (!availability.wingetPresent) {
            return {
                kind: "error",
                message:
                    "winget is not available on this machine. Install GitHub CLI manually from https://cli.github.com/, then run `@config agent refresh github-cli`.",
            };
        }
        return {
            kind: "ok",
            commands: [
                {
                    description:
                        "Installing GitHub CLI via winget (GitHub.cli)",
                    argv: [
                        "winget",
                        "install",
                        "--id",
                        "GitHub.cli",
                        "--silent",
                        "--scope",
                        "user",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                    ],
                },
            ],
        };
    }
    // Linux — apt-only, best effort.
    const linux = availability.linux;
    if (!linux || !linux.aptPresent) {
        return {
            kind: "error",
            message:
                "Automated install on Linux only supports apt-based distributions. Follow https://github.com/cli/cli/blob/trunk/docs/install_linux.md for your distro, then run `@config agent refresh github-cli`.",
        };
    }
    if (!linux.sudoNoninteractiveOk) {
        return {
            kind: "error",
            message:
                "Automated install requires passwordless sudo. Run `sudo apt-get install -y gh` in a terminal (you may need to add the GitHub apt repo first — see https://github.com/cli/cli/blob/trunk/docs/install_linux.md), then `@config agent refresh github-cli`.",
        };
    }
    return {
        kind: "ok",
        commands: [
            {
                description: "Installing GitHub CLI via apt-get",
                // sudo -n: never prompt for password (we already verified
                // passwordless sudo via probeLinuxInstaller).
                // NOTE: `gh` is only in stock apt repos on some distros.
                // If the package isn't found, apt-get will exit non-zero
                // and the failure tail directs the user to the GitHub
                // docs to add the official repo.
                argv: ["sudo", "-n", "apt-get", "install", "-y", "gh"],
            },
        ],
    };
}

// Probes the Linux installer environment.
export async function probeLinuxInstaller(): Promise<LinuxInstallerProbe> {
    const aptPresent = await whichExists("apt-get");
    if (!aptPresent) {
        return { aptPresent: false, sudoNoninteractiveOk: false };
    }
    const ok = await new Promise<boolean>((resolve) => {
        const child = spawn("sudo", ["-n", "true"], {
            stdio: ["ignore", "ignore", "ignore"],
        });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
    return { aptPresent, sudoNoninteractiveOk: ok };
}

// `where`/`which`-based PATH probe — boolean only. Same shape as the
// screencapture and code agents' equivalent helpers.
export async function whichExists(tool: string): Promise<boolean> {
    const cmd = process.platform === "win32" ? "where" : "which";
    return new Promise((resolve) => {
        const child = spawn(cmd, [tool], {
            stdio: ["ignore", "ignore", "ignore"],
            windowsHide: true,
        });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
}

// Filters out winget's CR-overwritten progress bar / spinner output —
// otherwise each redraw becomes a separate streamed line that floods
// the chat. Mirrors the screencapture agent's filter.
//
// Exported for unit tests.
export function isProgressNoise(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) return true;
    if (/^[-\\|/]$/.test(trimmed)) return true;
    if (/[█▒]/.test(trimmed)) return true;
    return false;
}

// Spawns a single setup command, streaming combined stdout/stderr lines
// to onLine. Resolves with { code, tail } where tail is the last ~40
// captured lines (including filtered progress noise) for the failure
// message.
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
