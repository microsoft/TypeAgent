// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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

// Subdirectory of the C# project where `dotnet publish -o` drops the helper
// exe. We deliberately use a subdir (not the project dir itself, via "-o ."):
// `dotnet publish -o .` from the project directory triggers a CS5001
// (no Main found) error from the C# compiler, apparently because publishing
// in-place perturbs the SDK's source-file enumeration. A subdir avoids the
// issue entirely. See: buildWindowsHelper().
const HELPER_PUBLISH_SUBDIR = "publish";
const HELPER_EXE_NAME = "OsNotificationListener.exe";

// Public probe used by checkReadiness — same exe-presence check the watcher
// does at startup, but split out so the agent's readiness hook doesn't have
// to spin up the full watcher to find out whether setup has been run.
export function isWindowsHelperBuilt(): boolean {
    return resolveHelperPath() !== undefined;
}

function resolveHelperPath(): string | undefined {
    // After build, postbuild copies bin/** -> dist/bin/**, and this module is
    // in dist/watchers/. Resolve relative to import.meta.url.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const projDirCandidates = [
        path.resolve(here, "..", "bin", "OsNotificationListener"),
        path.resolve(here, "..", "..", "bin", "OsNotificationListener"),
    ];
    for (const projDir of projDirCandidates) {
        // Preferred location — what buildWindowsHelper produces.
        const inPublish = path.join(
            projDir,
            HELPER_PUBLISH_SUBDIR,
            HELPER_EXE_NAME,
        );
        if (existsSync(inPublish)) return inPublish;
        // Legacy / hand-built location: directly in the project dir.
        const inRoot = path.join(projDir, HELPER_EXE_NAME);
        if (existsSync(inRoot)) return inRoot;
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

// Hard-coded subject the dev cert is issued to. Must match
// identity/AppxManifest.xml's <Identity Publisher="..."> exactly.
// Kept as a constant rather than read from somewhere else because it's
// the contract between the manifest and the cert; changing one without
// the other silently breaks signature validation.
const SIGNING_CERT_SUBJECT = "CN=dev.typeagent.microsoft.com";
const CODE_SIGNING_EKU = "1.3.6.1.5.5.7.3.3";
const IDENTITY_PACKAGE_NAME = "TypeAgent.OsNotificationListener";
const IDENTITY_DIR = "identity";
const MSIX_FILE = "TypeAgent.OsNotificationListener.msix";

// Full build pipeline for the WinAppSDK sparse-packaged helper:
//   dotnet clean + publish -> writes exe under publish/
//   makeappx pack identity/ -> writes signed MSIX
//   signtool sign -> embeds the dev-cert signature
//   Add-AppxPackage -ExternalLocation publish/ -> grants exe package identity
//
// onProgress streams every command's stdout/stderr to chat (typically piped
// to actionIO.appendDisplay). Errors include the last several lines of output
// since the live progress is rendered in "inline" mode that scrolls offscreen.
export async function buildWindowsHelper(opts: {
    onProgress?: (line: string) => void;
}): Promise<void> {
    const projDir = resolveHelperProjectDir();
    if (projDir === undefined) {
        throw new Error(
            "OS notification helper source (OsNotificationListener.csproj) not found. The agent's package may be incomplete.",
        );
    }
    const publishDir = path.join(projDir, HELPER_PUBLISH_SUBDIR);
    const identityDir = path.join(projDir, IDENTITY_DIR);
    const msixPath = path.join(projDir, MSIX_FILE);

    // 1. Clean + publish — produces the exe (with embedded app.manifest
    // pointing at the identity package). `-o publish/` instead of `-o .`
    // because publishing into the project dir trips a known CS5001
    // "no Main found" error in the SDK source-file enumeration.
    await runProcess("dotnet", ["clean", "-c", "Release"], projDir, opts).catch(
        () => {},
    );
    await runProcess(
        "dotnet",
        ["publish", "-c", "Release", "-r", "win-x64", "-o", publishDir],
        projDir,
        opts,
    );

    // 2. Locate Windows SDK tools. Cached lookups would be nice if this
    // ran often, but it runs once per agent build so the cost is fine.
    const sdk = findWindowsSdkBin();
    opts.onProgress?.(`[setup] using SDK at ${sdk.dir}`);

    // 3. Locate the dev cert and grab its thumbprint. Subject is stable
    // across `getCert renew` invocations, so this still works after key
    // rotation.
    const thumbprint = findSigningCertThumbprint();
    opts.onProgress?.(`[setup] signing with ${thumbprint}`);

    // 4. Pack identity manifest -> .msix. The /nv flag skips MakeAppx's
    // payload-file path validation; the identity package only contains the
    // manifest + placeholder logo, so payload validation is meaningless.
    await runProcess(
        sdk.makeappx,
        ["pack", "/o", "/d", identityDir, "/nv", "/p", msixPath],
        projDir,
        opts,
    );

    // 5. Sign the MSIX with the dev cert (selected by SHA1 thumbprint
    // from CurrentUser\My).
    await runProcess(
        sdk.signtool,
        ["sign", "/sha1", thumbprint, "/fd", "SHA256", msixPath],
        projDir,
        opts,
    );

    // 6. Register the sparse package so the exe at publishDir has package
    // identity at runtime. Re-registration is idempotent — Add-AppxPackage
    // accepts re-registering the same version when -ExternalLocation matches,
    // which is what we want during dev (rebuilds replace any prior version).
    await registerSparsePackage(msixPath, publishDir, opts);
}

// Searches well-known locations for makeappx.exe and signtool.exe. Returns
// the directory containing both. Throws with actionable guidance if not
// found (typically means the Windows 10/11 SDK isn't installed).
function findWindowsSdkBin(): {
    dir: string;
    makeappx: string;
    signtool: string;
} {
    const kitsRoots = [
        "C:\\Program Files (x86)\\Windows Kits\\10\\bin",
        "C:\\Program Files\\Windows Kits\\10\\bin",
    ];
    // SDK install layout: <bin>\<version>\x64\{makeappx,signtool}.exe
    // We pick the highest-numbered version directory that has both tools.
    let best: { dir: string; version: string } | undefined;
    for (const root of kitsRoots) {
        if (!existsSync(root)) continue;
        for (const versionDir of readdirSync(root)
            .filter((n: string) => /^10\.\d+\.\d+\.\d+$/.test(n))
            .sort((a: string, b: string) => compareVersions(b, a)) /* desc */) {
            const candidate = path.join(root, versionDir, "x64");
            if (
                existsSync(path.join(candidate, "makeappx.exe")) &&
                existsSync(path.join(candidate, "signtool.exe"))
            ) {
                if (!best || compareVersions(versionDir, best.version) > 0) {
                    best = { dir: candidate, version: versionDir };
                }
            }
        }
    }
    if (!best) {
        throw new Error(
            "Windows 10/11 SDK not found. Install via the Visual Studio Installer (Workloads → Desktop development with C++ → Windows SDK), or any 'Windows SDK' package from https://developer.microsoft.com/windows/downloads/windows-sdk/. Looking for makeappx.exe and signtool.exe under Program Files\\Windows Kits\\10\\bin\\<ver>\\x64.",
        );
    }
    return {
        dir: best.dir,
        makeappx: path.join(best.dir, "makeappx.exe"),
        signtool: path.join(best.dir, "signtool.exe"),
    };
}

function compareVersions(a: string, b: string): number {
    const ap = a.split(".").map(Number);
    const bp = b.split(".").map(Number);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
        const d = (ap[i] ?? 0) - (bp[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

// Queries CurrentUser\My for a code-signing cert with the expected Subject.
// Returns the SHA1 thumbprint suitable for `signtool sign /sha1 <thumb>`.
// Throws with guidance pointing at getCert.mjs if no usable cert is found.
function findSigningCertThumbprint(): string {
    const ps = `
        $cert = Get-ChildItem Cert:\\CurrentUser\\My |
            Where-Object {
                $_.Subject -eq '${SIGNING_CERT_SUBJECT}' -and
                $_.HasPrivateKey -and
                ($_.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId }) -contains '${CODE_SIGNING_EKU}'
            } |
            Sort-Object NotAfter -Descending |
            Select-Object -First 1
        if ($null -eq $cert) {
            Write-Output 'NOT_FOUND'
        } else {
            Write-Output $cert.Thumbprint
        }
    `;
    const out = runPowerShellSync(ps).trim();
    if (out === "NOT_FOUND" || out.length === 0) {
        throw new Error(
            "Dev signing cert not found in CurrentUser\\My. Run:\n" +
                "  node tools/scripts/getCert.mjs install --trusted-root\n" +
                "If the cert exists but lacks Code Signing EKU, also run:\n" +
                "  node tools/scripts/getCert.mjs renew\n" +
                "  node tools/scripts/getCert.mjs install --trusted-root\n" +
                `Looking for cert with Subject '${SIGNING_CERT_SUBJECT}' and EKU ${CODE_SIGNING_EKU}.`,
        );
    }
    return out;
}

// Registers the identity package against an external exe location. Idempotent —
// if the same package is already registered, Add-AppxPackage replaces it.
async function registerSparsePackage(
    msixPath: string,
    externalLocation: string,
    opts: { onProgress?: (line: string) => void },
): Promise<void> {
    // Both paths embedded as PowerShell single-quoted literals; escape '
    // by doubling per PowerShell's quoting rules.
    const esc = (s: string) => s.replace(/'/g, "''");
    const ps = `
        # Remove any prior registration so re-registering is clean.
        Get-AppxPackage -Name '${IDENTITY_PACKAGE_NAME}' -ErrorAction SilentlyContinue |
            Remove-AppxPackage -ErrorAction SilentlyContinue
        Add-AppxPackage -Path '${esc(msixPath)}' -ExternalLocation '${esc(externalLocation)}'
        $pkg = Get-AppxPackage -Name '${IDENTITY_PACKAGE_NAME}' -ErrorAction SilentlyContinue
        if (-not $pkg) {
            Write-Error 'Add-AppxPackage completed but the package is not registered.'
            exit 1
        }
        Write-Output "Registered: $($pkg.PackageFullName) at $($pkg.InstallLocation)"
    `;
    try {
        await runProcess(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                ps,
            ],
            path.dirname(msixPath),
            opts,
        );
    } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.includes("0x800B0109")) {
            throw new Error(
                "Add-AppxPackage failed with CERT_E_UNTRUSTEDROOT — the dev cert isn't trusted at the LocalMachine scope. " +
                    "From an elevated PowerShell, run:\n" +
                    '  $cer = "$env:USERPROFILE\\.typeagent\\TypeAgent-Development-Certificate.cer"\n' +
                    "  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\\LocalMachine\\Root\n" +
                    "  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople\n" +
                    "Then retry. (One-time per machine; cert renewals via getCert renew keep the same Subject so this stays valid.)",
            );
        }
        throw e;
    }
}

// Generic process runner. Streams stdout+stderr to opts.onProgress
// line-by-line, captures the same into a transcript, and on non-zero
// exit rejects with an Error containing the last 12 lines of output.
function runProcess(
    cmd: string,
    args: string[],
    cwd: string,
    opts: { onProgress?: (line: string) => void },
): Promise<void> {
    const label = path.basename(cmd, path.extname(cmd));
    return new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
        });

        // Per-stream line buffer so onProgress sees one full line at a time
        // even when chunks split mid-line. We also capture all stdout+stderr
        // lines into a transcript so we can surface the actual error when
        // the process exits non-zero.
        const buffers = { stdout: "", stderr: "" };
        const transcript: string[] = [];
        const onChunk = (chunk: string, stream: "stdout" | "stderr") => {
            buffers[stream] += chunk;
            let nl: number;
            while ((nl = buffers[stream].indexOf("\n")) !== -1) {
                const line = buffers[stream].slice(0, nl).replace(/\r$/, "");
                buffers[stream] = buffers[stream].slice(nl + 1);
                if (line.length > 0) {
                    const tagged = `[${label}] ${line}`;
                    transcript.push(tagged);
                    opts.onProgress?.(tagged);
                }
            }
        };
        child.stdout!.setEncoding("utf8");
        child.stderr!.setEncoding("utf8");
        child.stdout!.on("data", (c: string) => onChunk(c, "stdout"));
        child.stderr!.on("data", (c: string) => onChunk(c, "stderr"));

        child.on("error", (e) => {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                reject(
                    new Error(`\`${cmd}\` not found. ${cmdNotFoundHelp(cmd)}`),
                );
            } else {
                reject(e);
            }
        });
        child.on("exit", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            for (const stream of ["stdout", "stderr"] as const) {
                const tail = buffers[stream].trim();
                if (tail.length > 0) transcript.push(`[${label}] ${tail}`);
            }
            const tailLines = transcript.slice(-12);
            const tailText =
                tailLines.length > 0
                    ? `\nLast output:\n${tailLines.join("\n")}`
                    : "";
            reject(
                new Error(
                    `${label} exited with code=${code} signal=${signal}${tailText}`,
                ),
            );
        });
    });
}

function cmdNotFoundHelp(cmd: string): string {
    if (cmd === "dotnet") {
        return "Install the .NET 8 SDK and ensure dotnet is on PATH.";
    }
    if (cmd === "powershell.exe") {
        return "PowerShell is missing — that's deeply unusual on Windows. Check %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\.";
    }
    if (path.basename(cmd).toLowerCase() === "makeappx.exe") {
        return "Install the Windows 10/11 SDK via the Visual Studio Installer.";
    }
    if (path.basename(cmd).toLowerCase() === "signtool.exe") {
        return "Install the Windows 10/11 SDK via the Visual Studio Installer.";
    }
    return "";
}

// Synchronous PowerShell helper for the cert lookup — we only need the
// thumbprint string, no streaming. Throws on non-zero exit.
function runPowerShellSync(script: string): string {
    const result = spawnSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(
            `PowerShell exited with code ${result.status}: ${result.stderr || result.stdout}`,
        );
    }
    return result.stdout ?? "";
}
