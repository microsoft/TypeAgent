// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ReadinessReport,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

// Outcome of the cheap fs probe — split out so the decision function can
// be unit-tested without hitting disk or relying on platform.
//
//   ready            — binary exists at the expected (or AUTOSHELL_PATH) path
//   binary-missing   — autoShell.exe not found in either bin/Debug or
//                      bin/Release; setup() can build it
//   override-missing — AUTOSHELL_PATH is set but points at nothing; setup()
//                      can't help because we don't know where the user
//                      wants the binary placed
export type AutoShellProbe =
    | { kind: "ready"; binaryPath: string }
    | { kind: "binary-missing"; debugPath: string; releasePath: string }
    | { kind: "override-missing"; envPath: string };

// Pure decision function: platform + probe → readiness report. Mirrors
// the player/screencapture/github-cli pattern so it can be unit-tested
// without spawning processes or hitting disk. Exported for tests.
export function evaluateDesktopReadiness(
    platform: NodeJS.Platform,
    probe: AutoShellProbe,
): ReadinessReport {
    if (platform !== "win32") {
        return {
            state: "unsupported",
            message: `Desktop automation is Windows-only (autoShell targets net8.0-windows). Detected platform: ${platform}.`,
        };
    }
    switch (probe.kind) {
        case "ready":
            return { state: "ready" };
        case "binary-missing":
            return {
                state: "setup-required",
                message:
                    "autoShell.exe not found — the C# automation host hasn't been built yet.",
                details: [
                    "Run `@config agent setup desktop` to build it (`dotnet build` on `dotnet/autoShell/autoShell.csproj`).",
                    "",
                    "Expected at one of:",
                    `  - \`${probe.debugPath}\` (Debug)`,
                    `  - \`${probe.releasePath}\` (Release)`,
                ].join("\n"),
            };
        case "override-missing":
            return {
                state: "setup-required",
                message: `AUTOSHELL_PATH is set to \`${probe.envPath}\` but no file exists there.`,
                details:
                    "Either fix the path, build that file manually, or unset AUTOSHELL_PATH so the agent uses the default `dotnet/autoShell/bin/Debug/autoShell.exe`. Then run `@config agent refresh desktop`.",
            };
    }
}

// Resolves expected autoShell paths relative to the compiled JS location.
// `distUrl` is import.meta.url at the call site (passed in for testability).
//
// Layout:
//   <repo>/ts/packages/agents/desktop/dist/readiness.js   (this module)
//   <repo>/dotnet/autoShell/autoShell.csproj              (project)
//   <repo>/dotnet/autoShell/bin/{Debug,Release}/autoShell.exe   (binary)
//
// Five-segment relative climb (../../../../../) matches resolveAutoShellPath
// in connector.ts.
export function resolveAutoShellPaths(distUrl: URL): {
    csprojPath: string;
    debugBinaryPath: string;
    releaseBinaryPath: string;
} {
    const distDir = path.dirname(fileURLToPath(distUrl));
    const autoShellDir = path.resolve(
        distDir,
        "../../../../../dotnet/autoShell",
    );
    return {
        csprojPath: path.join(autoShellDir, "autoShell.csproj"),
        debugBinaryPath: path.join(
            autoShellDir,
            "bin",
            "Debug",
            "autoShell.exe",
        ),
        releaseBinaryPath: path.join(
            autoShellDir,
            "bin",
            "Release",
            "autoShell.exe",
        ),
    };
}

// Side-effecting probe — checks AUTOSHELL_PATH override first (matching
// connector.ts), then Debug, then Release. Cheap (existsSync) so this stays
// well within the AppAgent.checkReadiness contract.
export function probeAutoShell(
    env: NodeJS.ProcessEnv,
    distUrl: URL,
): AutoShellProbe {
    const envPath = env.AUTOSHELL_PATH;
    if (envPath) {
        const resolved = path.resolve(envPath);
        if (existsSync(resolved)) {
            return { kind: "ready", binaryPath: resolved };
        }
        return { kind: "override-missing", envPath: resolved };
    }
    const { debugBinaryPath, releaseBinaryPath } =
        resolveAutoShellPaths(distUrl);
    if (existsSync(debugBinaryPath)) {
        return { kind: "ready", binaryPath: debugBinaryPath };
    }
    if (existsSync(releaseBinaryPath)) {
        return { kind: "ready", binaryPath: releaseBinaryPath };
    }
    return {
        kind: "binary-missing",
        debugPath: debugBinaryPath,
        releasePath: releaseBinaryPath,
    };
}

export async function checkDesktopReadiness(): Promise<ReadinessReport> {
    return evaluateDesktopReadiness(
        process.platform,
        probeAutoShell(process.env, new URL(import.meta.url)),
    );
}

// HH:MM timestamp for status updates — same convention as
// screencapture's runInstall, so build progress reads consistently
// across agents.
function ts(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Spawns `dotnet build <csproj>` and streams stdout/stderr lines to the
// caller. Returns exit code + tail (last ~40 lines) for the failure-path
// message — keeps the chat output bounded if the build fails noisily.
async function runDotnetBuild(
    csprojPath: string,
    onLine: (line: string) => void,
): Promise<{ code: number; tail: string }> {
    return new Promise((resolve) => {
        const child = spawn(
            "dotnet",
            ["build", csprojPath, "-c", "Debug", "--nologo"],
            { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
        );
        const tailLines: string[] = [];
        const TAIL_MAX = 40;
        const handleData = (chunk: Buffer) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                if (!line) continue;
                onLine(line);
                tailLines.push(line);
                if (tailLines.length > TAIL_MAX) tailLines.shift();
            }
        };
        child.stdout?.on("data", handleData);
        child.stderr?.on("data", handleData);
        child.on("error", (err) => {
            tailLines.push(`spawn error: ${err.message}`);
            resolve({ code: -1, tail: tailLines.join("\n") });
        });
        child.on("exit", (code) => {
            resolve({ code: code ?? -1, tail: tailLines.join("\n") });
        });
    });
}

// setup hook — runs `dotnet build` on autoShell.csproj. The dispatcher
// only invokes setup() when checkReadiness reports `setup-required`, so we
// don't re-probe here; we just build. After this returns, the dispatcher
// re-runs checkReadiness, which flips to `ready` iff the binary now exists
// at the expected path.
export async function setupDesktop(
    actionContext: ActionContext<unknown>,
): Promise<ActionResult> {
    if (process.platform !== "win32") {
        return createActionResultFromError(
            "Desktop agent is Windows-only — `dotnet build` would produce a binary the agent can't run on this platform.",
        );
    }

    const { csprojPath } = resolveAutoShellPaths(new URL(import.meta.url));
    if (!existsSync(csprojPath)) {
        return createActionResultFromError(
            `autoShell project not found at \`${csprojPath}\`. The dotnet/autoShell sources may be missing from this checkout.`,
        );
    }

    const startMs = Date.now();
    actionContext.actionIO.appendDisplay(
        {
            type: "text",
            content: `[${ts()}] Building autoShell (\`dotnet build ${csprojPath} -c Debug\`). This can take 30–60 seconds on a clean checkout while NuGet packages restore.`,
            kind: "status",
        },
        "block",
    );

    const { code, tail } = await runDotnetBuild(csprojPath, (line) =>
        actionContext.actionIO.appendDisplay(
            { type: "text", content: `[${ts()}] ${line}`, kind: "status" },
            "inline",
        ),
    );
    const elapsed = Math.round((Date.now() - startMs) / 1000);

    if (code !== 0) {
        return createActionResultFromError(
            `[${ts()}] dotnet build failed after ${elapsed}s (exit ${code}). Last output:\n${tail}`,
        );
    }

    return createActionResultFromTextDisplay(
        `[${ts()}] autoShell built in ${elapsed}s. Re-run your desktop command — readiness was re-checked automatically.`,
    );
}
