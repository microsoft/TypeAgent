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

type Geometry = { x: number; y: number; width: number; height: number };

// Looks up a window's screen rectangle by PID via User32.GetWindowRect.
// Used to crop the desktop capture down to the target window — see
// targetInputArgs for why we don't use `gdigrab -i title=...`.
async function getWindowGeometry(pid: string): Promise<Geometry> {
    const pidNum = parseInt(pid, 10);
    if (!Number.isFinite(pidNum) || pidNum <= 0) {
        throw new Error(`Invalid window id: ${pid}`);
    }
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class TARect {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$proc = Get-Process -Id ${pidNum}
$h = $proc.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Error 'no main window'; exit 1 }
if ([TARect]::IsIconic($h)) { Write-Error 'window is minimized'; exit 1 }
$r = New-Object TARect+RECT
[void][TARect]::GetWindowRect($h, [ref]$r)
ConvertTo-Json -InputObject ([pscustomobject]@{
    X = $r.Left; Y = $r.Top
    Width = $r.Right - $r.Left
    Height = $r.Bottom - $r.Top
}) -Compress
`;
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
                script,
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
                        `Get window rect failed (code ${code}): ${stderr.trim() || "no output"}`,
                    ),
                );
                return;
            }
            try {
                const o = JSON.parse(stdout.trim());
                resolve({
                    x: Number(o.X),
                    y: Number(o.Y),
                    width: Number(o.Width),
                    height: Number(o.Height),
                });
            } catch (e: any) {
                reject(new Error(`Failed to parse window rect: ${e.message}`));
            }
        });
    });
}

// Builds the gdigrab input args for a screenshot/recording target.
//
// Full screen → simple `-i desktop`.
//
// Window target → DON'T use `-i title=<title>`. gdigrab's title path
// uses BitBlt against the window's GDI device context, which is empty
// for Chromium / Electron / any DirectComposition app (DWM composites
// their DXGI surface to the screen but the window's GDI DC stays
// untouched), so the captured frame is uniformly black. Capturing the
// desktop and cropping to the window's screen rectangle reads the same
// composited output the user is looking at — works for every window
// type. (Mirrors what the Linux x11grab backend does.)
//
// Caveat: occluded regions are captured as whatever's in front. The
// caller is responsible for foregrounding the window if that matters.
async function targetInputArgs(target: WindowInfo | null): Promise<string[]> {
    if (target === null) {
        return ["-i", "desktop"];
    }
    const g = await getWindowGeometry(target.id);
    // Even dims for libx264 yuv420p (recording). Harmless for PNG output.
    const w = g.width % 2 === 0 ? g.width : g.width - 1;
    const h = g.height % 2 === 0 ? g.height : g.height - 1;
    return [
        "-offset_x",
        String(g.x),
        "-offset_y",
        String(g.y),
        "-video_size",
        `${w}x${h}`,
        "-i",
        "desktop",
    ];
}

async function buildScreenshotArgs(
    target: WindowInfo | null,
    outPath: string,
): Promise<string[]> {
    return [
        "-y",
        "-f",
        "gdigrab",
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
        "gdigrab",
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

export const windowsBackend: PlatformBackend = {
    enumerateWindows,
    buildScreenshotArgs,
    buildRecordArgs,
    requiredTools: [],
    extensions: { screenshot: "png", recording: "mp4" },
};
