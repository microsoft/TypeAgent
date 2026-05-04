// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { runExploration } from "../explorer.js";
import { HelperClient } from "../helperClient.js";
import { StubOracle } from "../stubOracle.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[expl] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "_uic_explore_smoke",
    );
    // Wipe prior runs for a deterministic smoke.
    rmSync(workspaceDir, { recursive: true, force: true });

    const client = await HelperClient.start({ debug: true });
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

        const oracle = new StubOracle({ maxDecisions: 5 });
        log("running exploration with stub oracle (max 5 decisions)...");
        const metrics = await runExploration({
            client,
            oracle,
            workspaceDir,
            rootSelector: launch.mainWindow,
            captureScreenshots: false,
            treeMaxDepth: 8,
            budget: {
                maxIterations: 10,
                maxWallClockMs: 60_000,
                maxStates: 30,
                convergenceThreshold: 8,
                historyTailSize: 3,
            },
            onIteration: ({ iteration, state, decision }) => {
                if (decision.kind === "act") {
                    log(
                        `  iter ${iteration}: ${state.id} → ${decision.verb} ${decision.frontierId}`,
                    );
                } else {
                    log(
                        `  iter ${iteration}: ${state.id} → ${decision.kind} (${
                            "reason" in decision
                                ? decision.reason
                                : "rationale" in decision
                                  ? decision.rationale
                                  : ""
                        })`,
                    );
                }
            },
        });

        log("metrics:");
        log(`  runId=${metrics.runId}`);
        log(
            `  iterations=${metrics.iterations}  states=${metrics.statesDiscovered}  transitions=${metrics.transitionsRecorded}`,
        );
        log(
            `  successful=${metrics.successfulTransitions}  failed=${metrics.failedTransitions}`,
        );
        log(`  stopReason=${metrics.stopReason}  walltime=${metrics.walltimeMs}ms`);

        // Verify artifacts.
        const runDir = path.join(workspaceDir, "runs", metrics.runId);
        const statesFile = path.join(runDir, "states.jsonl");
        const transitionsFile = path.join(runDir, "transitions.jsonl");
        if (!existsSync(statesFile)) {
            throw new Error(`Missing states.jsonl at ${statesFile}`);
        }
        if (!existsSync(transitionsFile)) {
            throw new Error(`Missing transitions.jsonl at ${transitionsFile}`);
        }
        const stateLines = readFileSync(statesFile, "utf8")
            .split("\n")
            .filter((l) => l.length > 0);
        const transitionLines = readFileSync(transitionsFile, "utf8")
            .split("\n")
            .filter((l) => l.length > 0);
        log(
            `  on disk: ${stateLines.length} state line(s), ${transitionLines.length} transition line(s)`,
        );

        if (stateLines.length === 0) {
            throw new Error("Expected at least one state recorded");
        }
        if (transitionLines.length === 0) {
            throw new Error("Expected at least one transition recorded");
        }

        // Sanity-check first state record + first transition record shapes.
        const firstState = JSON.parse(stateLines[0]!);
        const firstTrans = JSON.parse(transitionLines[0]!);
        log(
            `  state[0] id=${firstState.id} fp=${firstState.fingerprint} window='${firstState.windowTitle}'`,
        );
        log(
            `  trans[0] ${firstTrans.fromStateId}→${firstTrans.toStateId} verb=${firstTrans.trigger.verb} success=${firstTrans.success}`,
        );

        // Verify per-state tree files exist.
        for (const line of stateLines) {
            const s = JSON.parse(line);
            const treePath = path.join(runDir, s.treeFile);
            if (!existsSync(treePath)) {
                throw new Error(`Missing tree file for ${s.id}: ${treePath}`);
            }
        }
        log(`  ✓ all state tree files present`);

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
