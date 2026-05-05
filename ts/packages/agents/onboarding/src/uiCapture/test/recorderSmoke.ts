// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { HelperClient } from "../helperClient.js";
import { Recorder } from "../recorder.js";
import type { TreeNode } from "../types.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[rec] ${msg}\n`);
}

function findFirst(
    node: TreeNode,
    pred: (n: TreeNode) => boolean,
): TreeNode | null {
    if (pred(node)) {
        return node;
    }
    for (const c of node.children) {
        const f = findFirst(c, pred);
        if (f) {
            return f;
        }
    }
    return null;
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "_uic_recorder_smoke",
    );

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

        log("starting recorder...");
        const recorder = await Recorder.start({
            client,
            workspaceDir,
            root: launch.mainWindow,
            eventTypes: [
                "Invoked",
                "ValueChanged",
                "ToggleStateChanged",
                "StructureChanged",
            ],
        });
        log(`session dir: ${recorder.sessionDir}`);

        // Drive Clock with stable, idempotent actions:
        //   1) navigate to Stopwatch (do.select on a NavView ListItem)
        //   2) navigate to Alarm (do.select)
        //   3) invoke a NavView action that's guaranteed to fire Invoked —
        //      we'll find any Invoke-pattern button that's not Close/Minimize
        //      to avoid tearing the window down mid-recording.
        const tree = await client.treeDump({
            root: launch.mainWindow,
            maxDepth: 8,
        });
        const stopwatchTab = findFirst(
            tree,
            (n) =>
                n.name === "Stopwatch" && n.patterns.includes("SelectionItem"),
        );
        const alarmTab = findFirst(
            tree,
            (n) => n.name === "Alarm" && n.patterns.includes("SelectionItem"),
        );
        const invokeBtn = findFirst(
            tree,
            (n) =>
                n.patterns.includes("Invoke") &&
                n.controlType === "Button" &&
                !!n.name &&
                !["Close Clock", "Minimize Clock", "Maximize Clock"].includes(
                    n.name,
                ),
        );

        if (stopwatchTab) {
            log(`do.select Stopwatch tab`);
            await client.doSelect({ selector: stopwatchTab.selector });
            await sleep(600);
        }
        if (alarmTab) {
            log(`do.select Alarm tab`);
            await client.doSelect({ selector: alarmTab.selector });
            await sleep(600);
        }
        if (invokeBtn) {
            // Use do.click (real Mouse.LeftClick) rather than do.invoke
            // (in-process pattern call) — UIA events propagate more reliably
            // for synthesized input than for in-process pattern invocations.
            log(`do.click "${invokeBtn.name}"`);
            try {
                await client.doClick({ selector: invokeBtn.selector });
                await sleep(600);
            } catch (e) {
                log(`  (click failed: ${e})`);
            }
        }

        // Allow events to drain before stopping.
        await sleep(1000);

        log("stopping recorder...");
        const stopped = await recorder.stop();
        log(`captured ${stopped.eventCount} event(s) in ${stopped.sessionDir}`);

        if (stopped.eventCount === 0) {
            throw new Error(
                "Expected at least one event captured during recording session",
            );
        }

        // Verify the JSONL file is well-formed and includes Invoked events.
        const jsonl = readFileSync(
            path.join(stopped.sessionDir, "transitions.jsonl"),
            "utf8",
        )
            .split("\n")
            .filter((l) => l.length > 0)
            .map((l) => JSON.parse(l));
        log(`parsed ${jsonl.length} JSONL line(s)`);

        const byType = new Map<string, number>();
        for (const e of jsonl) {
            byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
        }
        for (const [type, n] of byType) {
            log(`  ${type}: ${n}`);
        }

        const sampleInvoked = jsonl.find((e) => e.eventType === "Invoked");
        if (sampleInvoked) {
            log(
                `  sample Invoked: selector=${sampleInvoked.selector?.slice(0, 80)}...`,
            );
            log(
                `    snapshot: ct=${sampleInvoked.controlSnapshot?.controlType} aid=${sampleInvoked.controlSnapshot?.automationId}`,
            );
        }

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
