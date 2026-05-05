// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load ts/.env via Node 20.6+ built-in (avoids adding dotenv as a dep).
const __filename = fileURLToPath(import.meta.url);
// dist/uiCapture/test/llmExploreSmoke.js → six levels up is ts/ which holds .env.
const envPath = path.resolve(
    path.dirname(__filename),
    "../../../../../..",
    ".env",
);
try {
    (process as any).loadEnvFile(envPath);
} catch (e) {
    process.stderr.write(`[llm] could not load env from ${envPath}: ${e}\n`);
}

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import { LlmOracle } from "../llmOracle.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";
const GOAL =
    "Explore Windows Clock to discover the user-facing actions in each tab " +
    "(Focus sessions, Timer, Alarm, Stopwatch, World clock). Prefer breadth: " +
    "navigate to tabs that haven't been visited; within a tab, exercise the " +
    "primary action(s).";

function log(msg: string): void {
    process.stdout.write(`[llm] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "_uic_llm_explore_smoke",
    );
    rmSync(workspaceDir, { recursive: true, force: true });

    const client = await HelperClient.start({ debug: false });
    try {
        await client.ping();

        for (const w of (await client.appList()).filter((x) =>
            x.title.includes("Clock"),
        )) {
            await client.appKill({ pid: w.pid });
        }
        await sleep(1500);

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
        log(`launched pid=${launch.pid}`);

        let oracle: LlmOracle;
        try {
            oracle = new LlmOracle({ goal: GOAL, maxRetries: 2 });
        } catch (e) {
            log(
                `SKIP: failed to construct LlmOracle (likely missing API keys): ${e}`,
            );
            await client.appKill({ pid: launch.pid });
            return;
        }

        log(
            "running exploration with LLM oracle (budget: 8 iterations / 60s)...",
        );
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
                        `  iter ${iteration}: ${state.id} → ${decision.verb} ${decision.frontierId}: ${decision.rationale}`,
                    );
                } else {
                    log(
                        `  iter ${iteration}: ${state.id} → ${decision.kind}: ${
                            "reason" in decision
                                ? decision.reason
                                : "rationale" in decision
                                  ? decision.rationale
                                  : ""
                        }`,
                    );
                }
            },
        });

        log("metrics:");
        log(
            `  iterations=${metrics.iterations}  states=${metrics.statesDiscovered}  transitions=${metrics.transitionsRecorded}`,
        );
        log(
            `  successful=${metrics.successfulTransitions}  failed=${metrics.failedTransitions}`,
        );
        log(
            `  stopReason=${metrics.stopReason}  walltime=${metrics.walltimeMs}ms`,
        );

        const runDir = path.join(workspaceDir, "runs", metrics.runId);
        const stateLines = readFileSync(
            path.join(runDir, "states.jsonl"),
            "utf8",
        )
            .split("\n")
            .filter((l) => l.length > 0);
        const transitionLines = existsSync(
            path.join(runDir, "transitions.jsonl"),
        )
            ? readFileSync(path.join(runDir, "transitions.jsonl"), "utf8")
                  .split("\n")
                  .filter((l) => l.length > 0)
            : [];
        log(
            `  on disk: ${stateLines.length} states, ${transitionLines.length} transitions`,
        );

        // Show distinct windowTitles visited.
        const titles = new Set<string>();
        for (const line of stateLines) {
            titles.add(JSON.parse(line).windowTitle);
        }
        log(`  distinct window titles: ${[...titles].join(", ") || "(none)"}`);

        await client.appKill({ pid: launch.pid });
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
