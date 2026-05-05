// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Per-tab focused crawl: snapshot once, then for each tab restore +
// launch + run a tightly-scoped exploration goal + synthesize into the
// workspace's discoveredActions.json (merging). Final restore at the
// end leaves Clock as we found it.

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
    process.stderr.write(`[mtab] could not load env: ${e}\n`);
}

process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_5 = "300000";
process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_v = "180000";
process.env.AZURE_OPENAI_MAX_TIMEOUT = "300000";
process.env.OPENAI_MAX_TIMEOUT = "300000";

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import { LlmOracle } from "../llmOracle.js";
import { inferSnapshotPolicy } from "../snapshotPolicy.js";
import { synthesize } from "../synthesizer.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

const TAB_GOALS: Record<string, string> = {
    alarm: `On the Alarm tab of Windows Clock, perform these tasks in order:

1. Navigate to the Alarm tab (select the ListItem with AutomationId="AlarmButton").
2. Click "Add an alarm" (Button with AutomationId="AddAlarmButton") to open the new-alarm dialog.
3. Type "Wake Up Demo" into the alarm name field (Edit "Alarm name").
4. Set the HourPicker (Custom AutomationId="HourPicker") via setValue 7. If the value doesn't take, try clicking up/down arrow Buttons inside the picker.
5. Set the MinutePicker similarly to 30.
6. Click Save (Button AutomationId="PrimaryButton") to commit.
7. After saving, toggle one of the alarms in the list off, then on again.

After completing these tasks, choose 'stop'. Avoid any Delete buttons.`,

    stopwatch: `On the Stopwatch tab of Windows Clock, perform these tasks in order:

1. Navigate to the Stopwatch tab (select ListItem with AutomationId="StopwatchButton").
2. Click the play/pause button (Button AutomationId="StopwatchPlayPauseButton") to START.
3. Wait one iteration, then click the Lap button (Button AutomationId="StopWatchLapButton") to record a lap.
4. Click Lap once more.
5. Click the play/pause button again to PAUSE.
6. Click the play/pause button again to RESUME.

After completing these tasks, choose 'stop'. Don't click Reset (destructive).`,

    worldclock: `On the World Clock tab of Windows Clock, perform these tasks in order:

1. Navigate to the World Clock tab (select ListItem with AutomationId="ClockButton").
2. Click the "Add" button (Button AutomationId="AddClockButton") to open the add-city dialog.
3. Type "Tokyo" into the search field (Edit AutomationId="TextBox").
4. If results appear, click the first result; otherwise click Save / OK / PrimaryButton.

After completing these tasks, choose 'stop'. Avoid removing existing cities.`,

    focus: `On the Focus sessions tab of Windows Clock, perform these tasks in order:

1. Navigate to the Focus sessions tab (select ListItem with AutomationId="FocusButton").
2. If there's a duration input (Edit AutomationId="InputBox"), set it to 25.
3. Click "Start focus session" (Button AutomationId="StartButton") to begin.
4. Wait for the focus session to actually begin, then look for a Pause button and click it.
5. Look for a Resume button and click it.

After completing these tasks, choose 'stop'. Don't reset/cancel/skip the session.`,
};

const TAB_BUDGETS: Record<string, { maxIter: number; wallMs: number }> = {
    alarm: { maxIter: 18, wallMs: 5 * 60_000 },
    stopwatch: { maxIter: 12, wallMs: 4 * 60_000 },
    worldclock: { maxIter: 10, wallMs: 4 * 60_000 },
    focus: { maxIter: 12, wallMs: 4 * 60_000 },
};

function log(msg: string): void {
    process.stdout.write(`[mtab] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function killClock(client: HelperClient): Promise<void> {
    for (const w of (await client.appList()).filter((x) =>
        x.title.includes("Clock"),
    )) {
        try {
            await client.appKill({ pid: w.pid });
        } catch {
            /* already gone */
        }
    }
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const requestedTabs = argv.length > 0 ? argv : Object.keys(TAB_GOALS);
    log(`tabs to crawl: ${requestedTabs.join(", ")}`);

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
        log("inferring snapshot policy...");
        policy = await inferSnapshotPolicy({
            integrationName: "windowsClock",
            aumid: CLOCK_AUMID,
        });
        policy.detectionStatus = "user-confirmed";

        await killClock(client);
        await sleep(1500);

        baselineSnapshotDir = path.join(
            workspaceDir,
            "snapshots",
            `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}`,
        );
        log(`baseline snapshot → ${baselineSnapshotDir}`);
        const cap = await client.snapshotCapture({
            snapshotDir: baselineSnapshotDir,
            policy,
        });
        log(`  ${cap.bytes} bytes captured`);

        const oracle = new LlmOracle({
            goal: "(per-tab override)",
            maxRetries: 2,
        });

        for (const tab of requestedTabs) {
            const goal = TAB_GOALS[tab];
            const budget = TAB_BUDGETS[tab];
            if (!goal || !budget) {
                log(`SKIP unknown tab: ${tab}`);
                continue;
            }
            log("");
            log(`=== ${tab.toUpperCase()} crawl ===`);

            // Restore baseline before each tab so prior crawls don't pollute
            // the starting state.
            await killClock(client);
            log(`  restoring baseline...`);
            await client.snapshotRestore({
                snapshotDir: baselineSnapshotDir,
                policy,
            });

            log(`  launching Clock...`);
            const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
            await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });

            // Override the oracle's goal for THIS tab.
            (oracle as any).goal = goal;

            log(
                `  exploring (max ${budget.maxIter} iter / ${budget.wallMs / 1000}s wall)`,
            );
            const metrics = await runExploration({
                client,
                oracle,
                workspaceDir,
                rootSelector: launch.mainWindow,
                runId: `${tab}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
                captureScreenshots: false,
                treeMaxDepth: 8,
                idleDebounceMs: 600,
                idleMaxWaitMs: 4000,
                budget: {
                    maxIterations: budget.maxIter,
                    maxWallClockMs: budget.wallMs,
                    maxStates: 50,
                    convergenceThreshold: 6,
                    historyTailSize: 5,
                },
                onIteration: ({ iteration, state, decision }) => {
                    if (decision.kind === "act") {
                        const v =
                            decision.value !== undefined
                                ? ` ${JSON.stringify(decision.value)}`
                                : "";
                        log(
                            `    iter ${iteration}: ${state.id} → ${decision.verb}${v} ${decision.frontierId}`,
                        );
                    } else {
                        log(
                            `    iter ${iteration}: ${state.id} → ${decision.kind}`,
                        );
                    }
                },
            });
            log(
                `  explore done: ${metrics.iterations} iter, ${metrics.statesDiscovered} states, ${metrics.successfulTransitions}/${metrics.transitionsRecorded} succ, stop=${metrics.stopReason}`,
            );

            await client.appKill({ pid: launch.pid });

            log(
                `  synthesizing + merging into workspace discoveredActions.json...`,
            );
            const runDir = path.join(workspaceDir, "runs", metrics.runId);
            try {
                const result = await synthesize({
                    runDir,
                    integrationName: "windowsClock",
                    workspaceDir,
                });
                log(
                    `  synthesis: +${result.actions.length} action(s) this run`,
                );
                if (result.mergeStats) {
                    log(
                        `  merge: prior=${result.mergeStats.priorActionCount} +${result.mergeStats.addedActionCount} new ~${result.mergeStats.updatedActionCount} updated total=${result.mergeStats.finalActionCount}`,
                    );
                }
            } catch (e) {
                log(
                    `  synthesis failed: ${e instanceof Error ? e.message : e}`,
                );
            }
        }

        log("");
        log("=== final action set ===");
        const wsActions = path.join(workspaceDir, "discoveredActions.json");
        if (existsSync(wsActions)) {
            const merged = JSON.parse(readFileSync(wsActions, "utf8"));
            for (const a of merged.actions) {
                const params = a.parameters
                    .map(
                        (p: { name: string; type: string }) =>
                            `${p.name}:${p.type}`,
                    )
                    .join(", ");
                const flags = a.destructive ? " DESTRUCTIVE" : "";
                log(
                    `  • ${a.actionName}(${params})${flags} — ${a.playback.length} step(s)`,
                );
            }
        }
        log("DONE");
    } finally {
        if (baselineSnapshotDir && policy) {
            log("");
            log("=== restoring baseline (cleanup) ===");
            try {
                await killClock(client);
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
