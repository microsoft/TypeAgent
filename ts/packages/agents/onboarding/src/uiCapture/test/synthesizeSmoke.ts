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
    process.stderr.write(`[syn] could not load env from ${envPath}: ${e}\n`);
}

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import { LlmOracle } from "../llmOracle.js";
import { synthesize } from "../synthesizer.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";
const GOAL =
    "Explore Windows Clock by visiting each tab (Focus sessions, Timer, " +
    "Alarm, Stopwatch, World clock) at least once. Prefer breadth over depth.";

function log(msg: string): void {
    process.stdout.write(`[syn] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "_uic_synth_smoke",
    );
    rmSync(workspaceDir, { recursive: true, force: true });

    const client = await HelperClient.start({ debug: false });
    try {
        for (const w of (await client.appList()).filter((x) =>
            x.title.includes("Clock"),
        )) {
            await client.appKill({ pid: w.pid });
        }
        await sleep(1500);

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });

        log("=== phase 1: exploration ===");
        const oracle = new LlmOracle({ goal: GOAL, maxRetries: 2 });
        const metrics = await runExploration({
            client,
            oracle,
            workspaceDir,
            rootSelector: launch.mainWindow,
            captureScreenshots: false,
            treeMaxDepth: 8,
            budget: {
                maxIterations: 8,
                maxWallClockMs: 60_000,
                maxStates: 12,
                convergenceThreshold: 4,
                historyTailSize: 4,
            },
            onIteration: ({ iteration, state, decision }) => {
                if (decision.kind === "act") {
                    log(
                        `  iter ${iteration}: ${state.id} → ${decision.verb} ${decision.frontierId}`,
                    );
                } else {
                    log(`  iter ${iteration}: ${state.id} → ${decision.kind}`);
                }
            },
        });
        log(
            `explore done: ${metrics.iterations} iter, ${metrics.statesDiscovered} states, ${metrics.transitionsRecorded} transitions, stop=${metrics.stopReason}`,
        );

        await client.appKill({ pid: launch.pid });

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
            log(
                `  action: ${a.actionName}${a.destructive ? " (destructive)" : ""}`,
            );
            log(`    description: ${a.description}`);
            for (const p of a.parameters) {
                const eg = p.examples
                    .slice(0, 3)
                    .map((v) => JSON.stringify(v))
                    .join(", ");
                log(
                    `    param ${p.name}: ${p.type}${eg ? ` (e.g. ${eg})` : ""}`,
                );
            }
            log(`    playback steps: ${a.playback.length}`);
            for (let i = 0; i < a.playback.length && i < 4; i++) {
                const s = a.playback[i]!;
                const valPart =
                    s.valueRef !== undefined
                        ? ` ${s.valueRef}`
                        : s.valueLiteral !== undefined
                          ? ` ${JSON.stringify(s.valueLiteral)}`
                          : "";
                log(
                    `      ${i + 1}. ${s.verb}${valPart} on ${s.selector.split("/").pop()}`,
                );
            }
            if (a.playback.length > 4) {
                log(`      ... +${a.playback.length - 4} more`);
            }
        }

        if (!existsSync(result.discoveredActionsPath)) {
            throw new Error(`Missing ${result.discoveredActionsPath}`);
        }
        if (!existsSync(result.reportPath)) {
            throw new Error(`Missing ${result.reportPath}`);
        }
        const json = JSON.parse(
            readFileSync(result.discoveredActionsPath, "utf8"),
        );
        log(
            `discoveredActions.json: ${json.actions.length} action(s), version=${json.version}`,
        );
        log(`report: ${result.reportPath}`);
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
