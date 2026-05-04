// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const envPath = path.resolve(
    path.dirname(__filename),
    "../../../../../..",
    ".env",
);
try {
    (process as any).loadEnvFile(envPath);
} catch (e) {
    process.stderr.write(`[crawl] could not load env from ${envPath}: ${e}\n`);
}

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import { LlmOracle } from "../llmOracle.js";
import { inferSnapshotPolicy } from "../snapshotPolicy.js";
import { synthesize } from "../synthesizer.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

const GOAL = `Discover the user-facing actions Windows Clock offers across all tabs by performing concrete tasks. Each tab should be exercised:

- Alarm tab: create a new alarm (open the add-alarm dialog, set a time and/or name, save).
- Timer tab: create a new timer (set a duration, optionally name it, save), then start it.
- Stopwatch tab: start the stopwatch, then pause it.
- World clock tab: add a new city if there's an "Add city" button.
- Focus sessions tab: configure or start a focus session.

Constraints:
- Avoid deleting existing items (no destructive actions).
- Tasks usually take multiple steps (open a modal, fill fields, click Save). Don't bail early — drive the task to its completion state when possible.
- If you reach a modal dialog with a Save/OK action, click it once you've set the relevant fields.
- Don't navigate to a tab you've already exercised unless the previous attempt failed.`;

function log(msg: string): void {
    process.stdout.write(`[crawl] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "windowsClock",
    );
    rmSync(path.join(workspaceDir, "runs"), { recursive: true, force: true });

    const client = await HelperClient.start({ debug: false });
    let baselineSnapshotDir: string | null = null;
    let policy: Awaited<ReturnType<typeof inferSnapshotPolicy>> | null = null;

    try {
        // Phase 0: infer snapshot policy + take a baseline so the run is reversible.
        log("inferring snapshot policy for Clock...");
        policy = await inferSnapshotPolicy({
            integrationName: "windowsClock",
            aumid: CLOCK_AUMID,
        });
        log(
            `  status=${policy.detectionStatus} sources=${policy.state.length}`,
        );
        // For this smoke we self-confirm the auto-detected policy.
        policy.detectionStatus = "user-confirmed";

        // Make sure Clock isn't running before snapshot (file locks).
        for (const w of (await client.appList()).filter((x) =>
            x.title.includes("Clock"),
        )) {
            await client.appKill({ pid: w.pid });
        }
        await sleep(1500);

        baselineSnapshotDir = path.join(
            workspaceDir,
            "snapshots",
            `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}`,
        );
        log(`capturing baseline snapshot → ${baselineSnapshotDir}`);
        const cap = await client.snapshotCapture({
            snapshotDir: baselineSnapshotDir,
            policy,
        });
        log(
            `  captured ${cap.bytes} bytes across ${cap.sourceCount} source(s)`,
        );

        // Phase 1: launch + explore.
        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
        log(`launched pid=${launch.pid} mainWindow=${launch.mainWindow}`);

        log("=== phase 1: exploration (LLM oracle, budget: 25 iterations / 5min) ===");
        const oracle = new LlmOracle({ goal: GOAL, maxRetries: 2 });
        const metrics = await runExploration({
            client,
            oracle,
            workspaceDir,
            rootSelector: launch.mainWindow,
            captureScreenshots: false,
            treeMaxDepth: 8,
            idleDebounceMs: 600,
            idleMaxWaitMs: 4000,
            budget: {
                maxIterations: 25,
                maxWallClockMs: 5 * 60_000,
                maxStates: 40,
                convergenceThreshold: 8,
                historyTailSize: 5,
            },
            onIteration: ({ iteration, state, decision }) => {
                if (decision.kind === "act") {
                    const v =
                        decision.value !== undefined
                            ? ` ${JSON.stringify(decision.value)}`
                            : "";
                    log(
                        `  iter ${iteration}: ${state.id} → ${decision.verb}${v} ${decision.frontierId}`,
                    );
                } else {
                    log(`  iter ${iteration}: ${state.id} → ${decision.kind}`);
                }
            },
        });
        log(
            `explore done: ${metrics.iterations} iter, ${metrics.statesDiscovered} states, ${metrics.transitionsRecorded} transitions, ${metrics.successfulTransitions} successful, stop=${metrics.stopReason}`,
        );

        await client.appKill({ pid: launch.pid });

        // Phase 2: synthesize.
        log("=== phase 2: synthesis ===");
        const runDir = path.join(workspaceDir, "runs", metrics.runId);
        const result = await synthesize({
            runDir,
            integrationName: "windowsClock",
        });
        log(
            `synthesis done: ${result.actions.length} action(s), ${result.clusters.clusters.length} cluster(s), ${result.chunkCount} chunk(s)`,
        );
        for (const a of result.actions) {
            const flags = a.destructive ? " DESTRUCTIVE" : "";
            log(`  • ${a.actionName}${flags} — ${a.description}`);
            for (const p of a.parameters) {
                const eg = p.examples
                    .slice(0, 3)
                    .map((v) => JSON.stringify(v))
                    .join(", ");
                log(
                    `      ${p.name}: ${p.type}${p.enumValues ? ` (${p.enumValues.join("|")})` : ""}${eg ? ` ex=[${eg}]` : ""}`,
                );
            }
            log(`      playback: ${a.playback.length} step(s)`);
        }

        if (existsSync(result.discoveredActionsPath)) {
            const json = JSON.parse(
                readFileSync(result.discoveredActionsPath, "utf8"),
            );
            log(`✓ discoveredActions.json: ${json.actions.length} actions`);
        }
        log(`report: ${result.reportPath}`);
        log("DONE");
    } finally {
        // Phase 3: restore baseline so we leave Clock as we found it.
        if (baselineSnapshotDir && policy) {
            log("=== phase 3: restoring baseline ===");
            try {
                // Make sure Clock is closed before restore.
                for (const w of (await client.appList()).filter((x) =>
                    x.title.includes("Clock"),
                )) {
                    await client.appKill({ pid: w.pid });
                }
                const r = await client.snapshotRestore({
                    snapshotDir: baselineSnapshotDir,
                    policy,
                });
                log(`  restored ${r.bytes} bytes`);
            } catch (e) {
                log(`  restore failed: ${e}`);
            }
        }
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
