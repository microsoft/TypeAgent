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
    process.stderr.write(`[full] could not load env from ${envPath}: ${e}\n`);
}

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import { LlmOracle } from "../llmOracle.js";
import { inferSnapshotPolicy } from "../snapshotPolicy.js";
import { synthesize } from "../synthesizer.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

const GOAL = `Discover the user-facing actions Windows Clock offers. The app has 5 tabs:

  1. Focus sessions — start a focus session, optionally with a custom duration.
  2. Timer — create a timer, start it, then pause it.
  3. Alarm — create a new alarm with a name + time. (Don't delete existing alarms.)
  4. Stopwatch — start the stopwatch, then pause/stop it. Optionally take a lap.
  5. World clock — add a city if there's an "Add city" button.

For each tab, drive the primary actions through to completion. When you've fully exercised a tab, MOVE ON to the next one — don't loop within an already-explored tab.

Important behaviors:
- Multi-step tasks are normal: open dialog, fill fields, click Save.
- If a popup/modal appears unexpectedly (e.g., a permissions prompt, an unexpected confirmation), dismiss it via Cancel / Close / X.
- Don't repeat a setValue on the same control twice — if it didn't take effect, the picker may need a different verb (try clicking its child buttons) or the field may be unselectable.
- Skip already-completed tabs — move on if you see you've already exercised this area.
- Avoid deleting any user data (alarms, timers, cities). The crawl is meant to be additive only.`;

function log(msg: string): void {
    process.stdout.write(`[full] ${msg}\n`);
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
    // Wipe prior runs (but not the workspace-level discoveredActions.json — we want to merge).
    rmSync(path.join(workspaceDir, "runs"), { recursive: true, force: true });

    const client = await HelperClient.start({ debug: false });
    let baselineSnapshotDir: string | null = null;
    let policy: Awaited<ReturnType<typeof inferSnapshotPolicy>> | null = null;

    try {
        log("inferring snapshot policy...");
        policy = await inferSnapshotPolicy({
            integrationName: "windowsClock",
            aumid: CLOCK_AUMID,
        });
        policy.detectionStatus = "user-confirmed";

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
        log(`capturing baseline → ${baselineSnapshotDir}`);
        const cap = await client.snapshotCapture({
            snapshotDir: baselineSnapshotDir,
            policy,
        });
        log(`  ${cap.bytes} bytes across ${cap.sourceCount} source(s)`);

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
        log(`launched pid=${launch.pid}`);

        log(
            "=== phase 1: exploration (LLM oracle, budget: 60 iterations / 12min) ===",
        );
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
                maxIterations: 60,
                maxWallClockMs: 12 * 60_000,
                maxStates: 80,
                convergenceThreshold: 12,
                historyTailSize: 6,
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
            `explore done: ${metrics.iterations} iter, ${metrics.statesDiscovered} states, ${metrics.transitionsRecorded} transitions, ${metrics.successfulTransitions} successful, stop=${metrics.stopReason}, walltime=${(metrics.walltimeMs / 1000).toFixed(0)}s`,
        );

        await client.appKill({ pid: launch.pid });

        log("=== phase 2: synthesis (with merge into workspace) ===");
        const runDir = path.join(workspaceDir, "runs", metrics.runId);
        const result = await synthesize({
            runDir,
            integrationName: "windowsClock",
            workspaceDir, // enables merge
        });
        log(
            `synthesis: ${result.actions.length} action(s) this run, ${result.clusters.clusters.length} cluster(s), ${result.chunkCount} chunk(s)`,
        );
        if (result.mergeStats) {
            const m = result.mergeStats;
            log(
                `merge: prior=${m.priorActionCount}, +${m.addedActionCount} new, ~${m.updatedActionCount} updated, total=${m.finalActionCount}`,
            );
        }

        if (result.mergedActionsPath && existsSync(result.mergedActionsPath)) {
            const merged = JSON.parse(
                readFileSync(result.mergedActionsPath, "utf8"),
            );
            log(`Final action set in ${result.mergedActionsPath}:`);
            for (const a of merged.actions) {
                const flags = a.destructive ? " DESTRUCTIVE" : "";
                const params = a.parameters
                    .map((p: { name: string }) => p.name)
                    .join(", ");
                log(
                    `  • ${a.actionName}(${params})${flags} — ${a.playback.length} step(s)`,
                );
            }
        }

        log("DONE");
    } finally {
        if (baselineSnapshotDir && policy) {
            log("=== phase 3: restoring baseline ===");
            try {
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
