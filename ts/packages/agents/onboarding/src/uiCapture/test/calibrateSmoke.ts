// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { calibrateDynamicControls } from "../dynamicControls.js";
import { HelperClient } from "../helperClient.js";
import type { DynamicControlRule, TreeNode } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../..", "test/fixtures/uiCapture");

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[cal] ${msg}\n`);
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

async function runStopwatchCalibration(
    client: HelperClient,
    rootSelector: string,
): Promise<void> {
    log("navigating to Stopwatch...");
    let tree = await client.treeDump({ root: rootSelector, maxDepth: 8 });
    const stopwatchTab = findFirst(
        tree,
        (n) =>
            n.name === "Stopwatch" && n.patterns.includes("SelectionItem"),
    );
    if (!stopwatchTab) {
        throw new Error("Stopwatch tab not found in NavView");
    }
    await client.doSelect({ selector: stopwatchTab.selector });
    await client.eventsIdle({ debounceMs: 800, maxWaitMs: 3000 });

    log("starting stopwatch...");
    tree = await client.treeDump({ root: rootSelector, maxDepth: 8 });
    const startBtn = findFirst(
        tree,
        (n) =>
            (n.automationId === "PlayPauseButton" || n.name === "Start") &&
            n.patterns.includes("Invoke"),
    );
    if (!startBtn) {
        throw new Error("Stopwatch Start button not found");
    }
    await client.doInvoke({ selector: startBtn.selector });
    await sleep(500); // let stopwatch tick a bit before first dump

    log("calibrating (3 dumps over ~6s)...");
    const calibrated = await calibrateDynamicControls({
        client,
        rootSelector,
        integrationName: "windowsClock",
        dumpCount: 3,
        delayMs: 3000,
        maxDepth: 8,
    });
    log(
        `calibration: ${calibrated.rules.length} rule(s) in ${calibrated.calibration?.durationMs}ms`,
    );
    for (const r of calibrated.rules.slice(0, 8)) {
        log(
            `  rule ${r.id}: match=${JSON.stringify(r.match)} props=${JSON.stringify(r.dynamicProperties)} confidence=${r.confidence.toFixed(2)} semantic=${r.semantic ?? ""}`,
        );
    }

    if (calibrated.rules.length === 0) {
        throw new Error(
            "Expected at least one dynamic rule from calibration on a running stopwatch",
        );
    }

    // Save the calibrated file as a fixture for inspection.
    writeFileSync(
        path.join(fixturesDir, "clock-stopwatch-dynamic.json"),
        JSON.stringify(calibrated, null, 2),
    );
    log("saved clock-stopwatch-dynamic.json");

    // Verify rules-aware fingerprint is stable while stopwatch ticks.
    log("comparing fingerprints with and without rules over a 4s window...");
    const fpRulesA = await client.treeFingerprint({
        root: rootSelector,
        dynamicRules: calibrated.rules,
    });
    const fpNakedA = await client.treeFingerprint({ root: rootSelector });
    await sleep(4000);
    const fpRulesB = await client.treeFingerprint({
        root: rootSelector,
        dynamicRules: calibrated.rules,
    });
    const fpNakedB = await client.treeFingerprint({ root: rootSelector });

    log(`  with rules:    ${fpRulesA.hash} → ${fpRulesB.hash}`);
    log(`  without rules: ${fpNakedA.hash} → ${fpNakedB.hash}`);

    if (fpRulesA.hash !== fpRulesB.hash) {
        log(
            "  ⚠ rules-aware fingerprints differ — calibration likely missed a dynamic control",
        );
    } else {
        log("  ✓ rules-aware fingerprints match (dynamic content masked)");
    }
    if (fpNakedA.hash === fpNakedB.hash) {
        log(
            "  ⚠ naked fingerprints match — stopwatch may not have advanced (UI might be paused)",
        );
    } else {
        log("  ✓ naked fingerprints differ (stopwatch advanced)");
    }

    // Stop stopwatch.
    log("stopping stopwatch...");
    tree = await client.treeDump({ root: rootSelector, maxDepth: 8 });
    const stopBtn = findFirst(
        tree,
        (n) =>
            (n.automationId === "PlayPauseButton" ||
                n.automationId === "PauseButton" ||
                n.name === "Pause" ||
                n.name === "Stop") &&
            n.patterns.includes("Invoke"),
    );
    if (stopBtn) {
        await client.doInvoke({ selector: stopBtn.selector });
    }
    log("  stopwatch stopped");
}

async function runFingerprintBasics(
    client: HelperClient,
    rootSelector: string,
): Promise<void> {
    log("fingerprint basics...");
    const fpA = await client.treeFingerprint({ root: rootSelector });
    const fpB = await client.treeFingerprint({ root: rootSelector });
    log(`  back-to-back: ${fpA.hash} == ${fpB.hash}? ${fpA.hash === fpB.hash}`);
    if (fpA.hash !== fpB.hash) {
        throw new Error("Two fingerprints of the same instant should match");
    }
    log(
        `  controlCount=${fpA.controlCount} activeWindow='${fpA.activeWindowTitle}'`,
    );

    const closeRule: DynamicControlRule = {
        id: "test-close",
        match: { kind: "automationId", value: "Close" },
        dynamicProperties: ["name"],
        reason: "user-marked",
        confidence: 1,
        observations: 1,
        firstSeen: new Date().toISOString(),
        lastConfirmed: new Date().toISOString(),
    };
    const fpMasked = await client.treeFingerprint({
        root: rootSelector,
        dynamicRules: [closeRule],
    });
    log(`  with Close-name mask: ${fpMasked.hash}`);
    if (fpMasked.hash === fpA.hash) {
        throw new Error(
            "Masking the Close button's name should change the fingerprint",
        );
    }
    log("  ✓ rule application changes the fingerprint");
}

async function main(): Promise<void> {
    mkdirSync(fixturesDir, { recursive: true });
    const client = await HelperClient.start({ debug: true });
    try {
        await client.ping();

        // Close any existing Clock.
        for (const w of (await client.appList()).filter((x) =>
            x.title.includes("Clock"),
        )) {
            await client.appKill({ pid: w.pid });
        }
        await sleep(1500);

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });

        await runFingerprintBasics(client, launch.mainWindow);
        await runStopwatchCalibration(client, launch.mainWindow);

        // Cleanup.
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
