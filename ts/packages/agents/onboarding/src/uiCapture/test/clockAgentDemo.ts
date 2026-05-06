// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { HelperClient } from "../helperClient.js";
import { executePlayback } from "../playbackExecutor.js";
import { inferSnapshotPolicy } from "../snapshotPolicy.js";
import type { SynthesizedAction } from "../synthesisLlmSchema.js";
import type { TreeNode } from "../types.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";
const WORKSPACE = path.join(
    homedir(),
    ".typeagent",
    "onboarding",
    "windowsClock",
);

function log(msg: string): void {
    process.stdout.write(`[demo] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

function findMostRecentDir(parent: string): string {
    const entries = readdirSync(parent)
        .map((name) => ({
            name,
            full: path.join(parent, name),
            stat: statSync(path.join(parent, name)),
        }))
        .filter((e) => e.stat.isDirectory())
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (entries.length === 0) {
        throw new Error(`No directories under ${parent}`);
    }
    return entries[0]!.full;
}

function findActionByName(file: string, actionName: string): SynthesizedAction {
    const json = JSON.parse(readFileSync(file, "utf8"));
    const action = json.actions.find(
        (a: SynthesizedAction) => a.actionName === actionName,
    );
    if (!action) {
        throw new Error(
            `No action '${actionName}' in ${file} (have: ${json.actions.map((a: SynthesizedAction) => a.actionName).join(", ")})`,
        );
    }
    return action;
}

function findFirst(
    node: TreeNode,
    pred: (n: TreeNode) => boolean,
): TreeNode | null {
    if (pred(node)) return node;
    for (const c of node.children) {
        const f = findFirst(c, pred);
        if (f) return f;
    }
    return null;
}

function countMatches(node: TreeNode, pred: (n: TreeNode) => boolean): number {
    let n = pred(node) ? 1 : 0;
    for (const c of node.children) n += countMatches(c, pred);
    return n;
}

async function main(): Promise<void> {
    const runDir = findMostRecentDir(path.join(WORKSPACE, "runs"));
    const actionsFile = path.join(runDir, "discoveredActions.json");
    if (!existsSync(actionsFile)) {
        throw new Error(`No discoveredActions.json at ${actionsFile}`);
    }
    log(`run dir: ${runDir}`);

    const createAlarm = findActionByName(actionsFile, "createAlarm");
    log(
        `loaded createAlarm: ${createAlarm.parameters.length} params, ${createAlarm.playback.length} steps`,
    );

    // Find a baseline snapshot to restore against.
    const snapshotsDir = path.join(WORKSPACE, "snapshots");
    if (!existsSync(snapshotsDir)) {
        throw new Error(`No snapshots dir at ${snapshotsDir}`);
    }
    const baselineSnapshotDir = findMostRecentDir(snapshotsDir);
    log(`baseline snapshot: ${baselineSnapshotDir}`);

    const policy = await inferSnapshotPolicy({
        integrationName: "windowsClock",
        aumid: CLOCK_AUMID,
    });
    policy.detectionStatus = "user-confirmed";

    const client = await HelperClient.start({ debug: false });
    try {
        // Make sure Clock is closed before we restore (file locks).
        for (const w of (await client.appList()).filter((x) =>
            x.title.includes("Clock"),
        )) {
            await client.appKill({ pid: w.pid });
        }
        await sleep(1500);

        log("restoring baseline so we have a known starting point...");
        await client.snapshotRestore({
            snapshotDir: baselineSnapshotDir,
            policy,
        });

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
        log(`launched pid=${launch.pid}`);

        // Count Toggle controls (each alarm has one) BEFORE running the action,
        // restricted to the alarm tab area.
        const treeBefore = await client.treeDump({
            root: launch.mainWindow,
            maxDepth: 10,
        });
        const togglesBefore = countMatches(
            treeBefore,
            (n) => n.automationId === "AlarmViewGrid",
        );
        log(`alarm-toggle ListItems before: ${togglesBefore}`);

        const params = {
            alarmName: "Crawled Demo Alarm",
            hour: 8,
            minute: 15,
        };
        log(`executing createAlarm with ${JSON.stringify(params)}...`);
        const result = await executePlayback(createAlarm, params, {
            client,
            defaultIdleDebounceMs: 700,
            defaultIdleMaxWaitMs: 4000,
        });

        log(
            `playback ${result.success ? "OK" : "FAILED"} (${result.steps.length} step(s))`,
        );
        for (const s of result.steps) {
            const v =
                s.value !== undefined ? ` ${JSON.stringify(s.value)}` : "";
            const status = s.success ? "✓" : "✗";
            log(
                `  ${status} step ${s.stepIndex + 1}: ${s.verb}${v} (${s.durationMs}ms)${
                    s.errorMessage ? ` — ${s.errorMessage}` : ""
                }`,
            );
        }

        // Count alarm toggles after; expect +1 if action worked.
        await sleep(800);
        const treeAfter = await client.treeDump({
            root: launch.mainWindow,
            maxDepth: 10,
        });
        const togglesAfter = countMatches(
            treeAfter,
            (n) => n.automationId === "AlarmViewGrid",
        );
        log(`alarm-toggle ListItems after: ${togglesAfter}`);

        // Look for an alarm whose name contains our test string.
        // Alarms render as DataItem with name like "Edit alarm, <name>, <time>, ...".
        const namedAlarm = findFirst(
            treeAfter,
            (n) =>
                n.automationId === "AlarmViewGrid" &&
                (n.name?.includes("Crawled Demo Alarm") ?? false),
        );
        if (namedAlarm) {
            log(`✓ found new alarm in tree: '${namedAlarm.name}'`);
        } else if (togglesAfter > togglesBefore) {
            log(
                `~ alarm count increased (${togglesBefore} → ${togglesAfter}) but couldn't match name`,
            );
        } else {
            log(`✗ no new alarm detected — playback didn't take effect`);
        }

        // Cleanup: kill Clock + restore baseline so we leave nothing behind.
        await client.appKill({ pid: launch.pid });
        await sleep(1000);
        log("restoring baseline (cleanup)...");
        const restored = await client.snapshotRestore({
            snapshotDir: baselineSnapshotDir,
            policy,
        });
        log(`  restored ${restored.bytes} bytes`);
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
