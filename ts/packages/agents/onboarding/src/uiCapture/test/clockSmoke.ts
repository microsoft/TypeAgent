// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HelperClient } from "../helperClient.js";
import type { TreeNode } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/uiCapture/test/clockSmoke.js → package root is three levels up.
const fixturesDir = path.resolve(
    __dirname,
    "../../..",
    "test/fixtures/uiCapture",
);

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";
const CLOSE_SELECTOR =
    '/Window[Name="Clock"]/Window[AutomationId="TitleBar"]/Button[AutomationId="Close"]';

function log(msg: string): void {
    process.stdout.write(`[smoke] ${msg}\n`);
}

function countNodes(node: TreeNode): number {
    return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
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

function saveFixture(name: string, data: unknown): void {
    writeFileSync(path.join(fixturesDir, name), JSON.stringify(data, null, 2));
    log(`saved ${name}`);
}

async function main(): Promise<void> {
    mkdirSync(fixturesDir, { recursive: true });
    log(`fixtures → ${fixturesDir}`);

    const client = await HelperClient.start({ debug: true });
    try {
        const ping = await client.ping();
        log(`ping ok, version=${ping.version}`);

        // Close any pre-existing Clock instances.
        const existing = await client.appList();
        for (const w of existing.filter((x) => x.title.includes("Clock"))) {
            log(`closing existing Clock pid=${w.pid}`);
            await client.appKill({ pid: w.pid });
        }
        if (existing.some((x) => x.title.includes("Clock"))) {
            await sleep(1500);
        }

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        log(`launched pid=${launch.pid} mainWindow=${launch.mainWindow}`);

        // Wait for UIA to settle, then poll until the NavView shows up
        // (UWP populates the tree progressively after window creation).
        const idle1 = await client.eventsIdle({
            debounceMs: 800,
            maxWaitMs: 5000,
        });
        log(`events.idle #1: idle=${idle1.idle}, waited=${idle1.waitedMs}ms`);

        let tree = await client.treeDump({
            root: launch.mainWindow,
            maxDepth: 8,
        });
        let attempts = 0;
        while (
            !findFirst(tree, (n) => n.automationId === "NavView") &&
            attempts < 8
        ) {
            await sleep(400);
            tree = await client.treeDump({
                root: launch.mainWindow,
                maxDepth: 8,
            });
            attempts++;
        }
        log(
            `tree settled after ${attempts} polls: ${countNodes(tree)} nodes ` +
                `(NavView ${findFirst(tree, (n) => n.automationId === "NavView") ? "found" : "missing"})`,
        );
        saveFixture("clock-tree-launched.json", tree);

        const shot = await client.screenshot({ root: launch.mainWindow });
        writeFileSync(
            path.join(fixturesDir, "clock-launched.png"),
            Buffer.from(shot.pngBase64, "base64"),
        );
        log(`screenshot saved (${shot.rect.width}x${shot.rect.height})`);

        // Verify `find` works against a known stable selector.
        const closeFind = await client.find({ selector: CLOSE_SELECTOR });
        if (!closeFind.found) {
            throw new Error("find: Close button not resolved");
        }
        log(`find: Close button resolved=${closeFind.resolved}`);

        // Try to navigate to a known nav tab. NavView items are ListItem
        // with SelectionItem pattern (so do.select, not do.invoke).
        const navNames = [
            "Alarm",
            "Alarms",
            "Timer",
            "Stopwatch",
            "World clock",
            "Focus sessions",
        ];
        const navTab = navNames.reduce<TreeNode | null>(
            (acc, n) =>
                acc ??
                findFirst(
                    tree,
                    (node) =>
                        node.name === n &&
                        (node.patterns.includes("SelectionItem") ||
                            node.patterns.includes("Invoke")),
                ),
            null,
        );

        if (navTab) {
            const verb = navTab.patterns.includes("SelectionItem")
                ? "select"
                : "invoke";
            log(`nav tab found: ${navTab.name} → ${navTab.selector}`);
            const navFind = await client.find({
                selector: navTab.selector,
                timeoutMs: 1000,
            });
            log(`find nav tab: found=${navFind.found}`);
            log(`do.${verb} nav tab`);
            if (verb === "select") {
                await client.doSelect({ selector: navTab.selector });
            } else {
                await client.doInvoke({ selector: navTab.selector });
            }
            const idle2 = await client.eventsIdle({
                debounceMs: 800,
                maxWaitMs: 3000,
            });
            log(
                `events.idle #2: idle=${idle2.idle}, waited=${idle2.waitedMs}ms`,
            );
            const navTree = await client.treeDump({
                root: launch.mainWindow,
                maxDepth: 8,
            });
            saveFixture("clock-tree-navigated.json", navTree);
            log(`post-nav tree: ${countNodes(navTree)} nodes`);
        } else {
            log("no nav tab found, skipping navigation");
        }

        // Exercise do.focus (no observable result, just that it doesn't throw).
        await client.doFocus({ selector: CLOSE_SELECTOR });
        log("do.focus ok");

        // Final cleanup: invoke Close.
        await client.doInvoke({ selector: CLOSE_SELECTOR });
        await sleep(800);
        try {
            await client.appKill({ pid: launch.pid });
        } catch {
            /* already gone */
        }
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
