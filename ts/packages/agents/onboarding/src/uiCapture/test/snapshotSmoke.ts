// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { HelperClient } from "../helperClient.js";
import { inferSnapshotPolicy } from "../snapshotPolicy.js";
import type { SnapshotPolicy } from "../types.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[snap] ${msg}\n`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
    if (actual !== expected) {
        throw new Error(
            `[FAIL ${label}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
    log(`  ✓ ${label}`);
}

async function testInferForClock(): Promise<void> {
    log("inferSnapshotPolicy for Clock...");
    const policy = await inferSnapshotPolicy({
        integrationName: "windowsClock",
        aumid: CLOCK_AUMID,
    });
    log(
        `  detection=${policy.detectionStatus} sources=${policy.state.length} aumid=${policy.processIdentity.aumid}`,
    );
    for (const s of policy.state) {
        if (s.kind === "folder") {
            log(`  folder: ${s.path}`);
        }
    }
    if (policy.state.length === 0) {
        throw new Error(
            "Expected at least one detected folder source for Clock — is the package installed?",
        );
    }
    const hasLocalState = policy.state.some(
        (s) =>
            s.kind === "folder" &&
            s.path.toLowerCase().endsWith(path.sep + "localstate"),
    );
    if (!hasLocalState) {
        throw new Error("Expected LocalState folder in detected sources");
    }
    log("  ✓ Clock policy inferred with LocalState");
}

async function testCaptureRestoreSynthetic(client: HelperClient): Promise<void> {
    log("synthetic snapshot capture/restore...");
    // Create a sandboxed state directory we control.
    const root = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "_uic_snapshot_smoke",
    );
    const stateDir = path.join(root, "state");
    const snapshotDir = path.join(root, "snapshot");

    // Clean slate.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(stateDir, { recursive: true });

    // Seed state.
    writeFileSync(path.join(stateDir, "alarms.txt"), "7:00 Wake\n8:00 Standup\n");
    writeFileSync(path.join(stateDir, "settings.json"), '{"sound":"chime"}');
    mkdirSync(path.join(stateDir, "nested"), { recursive: true });
    writeFileSync(path.join(stateDir, "nested", "log.txt"), "initial log\n");

    const policy: SnapshotPolicy = {
        version: 1,
        integrationName: "_uic_smoke",
        detectionStatus: "user-provided",
        processIdentity: {},
        state: [
            {
                kind: "folder",
                path: stateDir,
                recursive: true,
                requireKill: false, // synthetic — no app to kill
            },
        ],
    };

    log("  capturing...");
    const cap = await client.snapshotCapture({ snapshotDir, policy });
    log(`  captured ${cap.bytes} bytes across ${cap.sourceCount} source(s)`);
    if (cap.bytes <= 0) {
        throw new Error("Expected non-zero capture bytes");
    }

    // Dirty the state.
    writeFileSync(path.join(stateDir, "alarms.txt"), "(corrupted)\n");
    rmSync(path.join(stateDir, "settings.json"));
    writeFileSync(path.join(stateDir, "extra.txt"), "should be removed on restore");
    writeFileSync(path.join(stateDir, "nested", "log.txt"), "(corrupted)\n");
    log("  state dirtied");

    log("  restoring...");
    const res = await client.snapshotRestore({ snapshotDir, policy });
    log(`  restored ${res.bytes} bytes`);

    assertEqual(
        readFileSync(path.join(stateDir, "alarms.txt"), "utf8"),
        "7:00 Wake\n8:00 Standup\n",
        "alarms.txt restored",
    );
    assertEqual(
        readFileSync(path.join(stateDir, "settings.json"), "utf8"),
        '{"sound":"chime"}',
        "settings.json restored",
    );
    assertEqual(
        readFileSync(path.join(stateDir, "nested", "log.txt"), "utf8"),
        "initial log\n",
        "nested log.txt restored",
    );
    if (existsSync(path.join(stateDir, "extra.txt"))) {
        throw new Error(
            "extra.txt should have been removed by restore (replace, not merge)",
        );
    }
    log("  ✓ extra.txt removed (replace semantics)");

    // Cleanup snapshot dir.
    await client.snapshotDelete({ snapshotDir });
    log("  ✓ snapshot deleted");

    rmSync(root, { recursive: true, force: true });
}

async function main(): Promise<void> {
    const client = await HelperClient.start({ debug: true });
    try {
        await testInferForClock();
        await testCaptureRestoreSynthetic(client);
        log("DONE");
    } finally {
        await client.dispose();
    }
}

main().catch((e) => {
    process.stderr.write(`FAILED: ${e}\n`);
    if (e instanceof Error && e.stack) {
        process.stderr.write(e.stack + "\n");
    }
    process.exit(1);
});
