// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    process.stderr.write(`[recon] could not load env from ${envPath}: ${e}\n`);
}

// GPT-5 reasoning + vision calls take time on big prompts; bump the
// suffixed timeout (aiclient's empty-string default short-circuits the
// fallback to the unsuffixed var).
process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_5 = "300000";
process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_v = "180000";
process.env.AZURE_OPENAI_MAX_TIMEOUT = "300000";
process.env.OPENAI_MAX_TIMEOUT = "300000";

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import {
    iterativeReconnoiter,
    renderIterativeReconAsGoal,
} from "../iterativeReconnaissance.js";
import { LlmOracle } from "../llmOracle.js";
import { inferSnapshotPolicy } from "../snapshotPolicy.js";
import { synthesize } from "../synthesizer.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[recon] ${msg}\n`);
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

        log("=== phase 1: iterative vision reconnaissance ===");
        const recon = await iterativeReconnoiter({
            client,
            rootSelector: launch.mainWindow,
            appHint: "Windows Clock (Microsoft Alarms & Clock)",
            maxIterations: 25,
            settleMs: 1000,
        });
        log(
            `recon found ${recon.expectedActions.length} expected action(s) in ${recon.iterationsUsed} turn(s)`,
        );
        const byTab = new Map<string, typeof recon.expectedActions>();
        for (const a of recon.expectedActions) {
            const list = byTab.get(a.tabOrSection) ?? [];
            list.push(a);
            byTab.set(a.tabOrSection, list);
        }
        for (const [tab, actions] of byTab) {
            log(`  ${tab} (${actions.length} action(s)):`);
            for (const a of actions) {
                const params = a.parameters
                    .map(
                        (p) =>
                            `${p.name}:${p.type}=${JSON.stringify(p.example)}`,
                    )
                    .join(", ");
                const flags = `${a.priority}${a.destructive ? "/destructive" : ""}`;
                log(`    • ${a.intentName}(${params}) [${flags}]`);
            }
        }
        // Save the reconnaissance for inspection.
        writeFileSync(
            path.join(workspaceDir, "reconnaissance.json"),
            JSON.stringify(recon, null, 2),
        );

        const goal = renderIterativeReconAsGoal(recon);
        log("");
        log(
            "=== phase 2: targeted exploration (LLM oracle, recon-driven goal) ===",
        );
        log(`goal preview: ${goal.split("\n").slice(0, 4).join(" / ")}...`);

        const oracle = new LlmOracle({ goal, maxRetries: 2 });
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
                // One TODO list item is roughly one alarm/timer/etc; allocate
                // 4-5 iterations per expected action plus headroom.
                maxIterations: Math.min(
                    100,
                    Math.max(40, recon.expectedActions.length * 5),
                ),
                maxWallClockMs: 15 * 60_000,
                maxStates: 100,
                convergenceThreshold: 14,
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

        log("=== phase 3: synthesis ===");
        const runDir = path.join(workspaceDir, "runs", metrics.runId);
        const result = await synthesize({
            runDir,
            integrationName: "windowsClock",
            workspaceDir,
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
        if (result.validation) {
            const fragmentsOrDups = result.validation.reviews.filter(
                (r) => r.verdict !== "ok",
            );
            log(
                `validation: ${result.validation.reviews.length - fragmentsOrDups.length} ok, ${fragmentsOrDups.length} flagged`,
            );
            for (const r of fragmentsOrDups) {
                log(`  ${r.verdict.toUpperCase()} ${r.actionName}: ${r.note}`);
            }
        }
        if (result.mergedActionsPath && existsSync(result.mergedActionsPath)) {
            const merged = JSON.parse(
                readFileSync(result.mergedActionsPath, "utf8"),
            );
            log("Final action set:");
            for (const a of merged.actions) {
                const flags = a.destructive ? " DESTRUCTIVE" : "";
                const params = a.parameters
                    .map(
                        (p: { name: string; type: string }) =>
                            `${p.name}:${p.type}`,
                    )
                    .join(", ");
                log(
                    `  • ${a.actionName}(${params})${flags} — ${a.playback.length} step(s)`,
                );
            }
        }
        log("DONE");
    } finally {
        if (baselineSnapshotDir && policy) {
            log("=== phase 4: restoring baseline ===");
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
