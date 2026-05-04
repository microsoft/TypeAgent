// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type {
    DetectionStatus,
    ProcessIdentity,
    SnapshotPolicy,
    SnapshotSource,
} from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Resolve PackageFamilyName for a UWP package name (the part of the AUMID
 * before the underscore). Returns null if the package isn't installed.
 */
async function getPackageFamilyName(packageName: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `(Get-AppxPackage -Name '${packageName}' | Select-Object -First 1).PackageFamilyName`,
            ],
            { timeout: 10_000 },
        );
        const pfn = stdout.trim();
        return pfn.length > 0 ? pfn : null;
    } catch {
        return null;
    }
}

/**
 * Auto-detect a snapshot policy for a UWP app by AUMID.
 * AUMID format: `<PackageName>_<PublisherHash>!<App>` —
 * e.g., `Microsoft.WindowsAlarms_8wekyb3d8bbwe!App`.
 */
export async function inferSnapshotPolicy(opts: {
    integrationName: string;
    aumid?: string;
    exePath?: string;
}): Promise<SnapshotPolicy> {
    const policy: SnapshotPolicy = {
        version: 1,
        integrationName: opts.integrationName,
        detectionStatus: "auto-candidate",
        processIdentity: {
            ...(opts.aumid !== undefined ? { aumid: opts.aumid } : {}),
            ...(opts.exePath !== undefined ? { exePath: opts.exePath } : {}),
        },
        state: [],
    };

    if (opts.aumid) {
        const packageName = opts.aumid.split("_")[0]!;
        const pfn = await getPackageFamilyName(packageName);
        if (pfn) {
            const localAppData = process.env.LOCALAPPDATA ?? "";
            const baseDir = path.join(localAppData, "Packages", pfn);
            for (const sub of ["LocalState", "Settings", "RoamingState"]) {
                const candidate = path.join(baseDir, sub);
                if (existsSync(candidate)) {
                    const folderSource: SnapshotSource = {
                        kind: "folder",
                        path: candidate,
                        recursive: true,
                    };
                    policy.state.push(folderSource);
                }
            }
            const processName = inferProcessName(packageName);
            if (processName !== undefined) {
                policy.processIdentity.processName = processName;
            }
        }
    } else if (opts.exePath) {
        // Win32 fallback. We don't currently auto-discover state directories
        // for Win32 apps; the user is expected to fill in the policy.
        policy.processIdentity.processName = path.basename(opts.exePath);
    }

    if (policy.state.length === 0) {
        policy.detectionStatus = "auto-candidate";
    }
    return policy;
}

/**
 * Best-effort process-name guess for known packages. The package name doesn't
 * always match the executable name; this table is small for now and grows as
 * we onboard real apps.
 */
function inferProcessName(packageName: string): string | undefined {
    const map: Record<string, string> = {
        "Microsoft.WindowsAlarms": "Time.exe",
        "Microsoft.WindowsCalculator": "CalculatorApp.exe",
    };
    return map[packageName];
}

export function loadSnapshotPolicy(workspaceDir: string): SnapshotPolicy | null {
    const file = path.join(workspaceDir, "snapshotPolicy.json");
    if (!existsSync(file)) {
        return null;
    }
    return JSON.parse(readFileSync(file, "utf8")) as SnapshotPolicy;
}

export function saveSnapshotPolicy(
    workspaceDir: string,
    policy: SnapshotPolicy,
): void {
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
        path.join(workspaceDir, "snapshotPolicy.json"),
        JSON.stringify(policy, null, 2),
    );
}

/**
 * Mark a policy as confirmed by user review.
 */
export function approveSnapshotPolicy(policy: SnapshotPolicy): SnapshotPolicy {
    return { ...policy, detectionStatus: "user-confirmed" as DetectionStatus };
}

/**
 * Build an empty policy declaring an integration has no persisted state.
 */
export function makeStatelessPolicy(
    integrationName: string,
    processIdentity: ProcessIdentity = {},
): SnapshotPolicy {
    return {
        version: 1,
        integrationName,
        detectionStatus: "no-state",
        processIdentity,
        state: [],
    };
}
