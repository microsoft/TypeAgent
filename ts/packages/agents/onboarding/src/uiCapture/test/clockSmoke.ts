// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HelperClient } from "../helperClient.js";
import type { TreeNode } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/uiCapture/test/clockSmoke.js → package root is three levels up.
const fixturesDir = path.resolve(__dirname, "../../..", "test/fixtures/uiCapture");

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[smoke] ${msg}\n`);
}

function countNodes(node: TreeNode): number {
    return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}

function countInvocableButtons(node: TreeNode): number {
    let n = node.patterns.includes("Invoke") && node.controlType === "Button" ? 1 : 0;
    for (const c of node.children) {
        n += countInvocableButtons(c);
    }
    return n;
}

function findInvocable(node: TreeNode, namePrefix?: string): TreeNode | null {
    if (
        node.patterns.includes("Invoke") &&
        node.isEnabled &&
        (!namePrefix || (node.name ?? "").startsWith(namePrefix))
    ) {
        return node;
    }
    for (const c of node.children) {
        const f = findInvocable(c, namePrefix);
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
    mkdirSync(fixturesDir, { recursive: true });
    log(`fixtures → ${fixturesDir}`);

    const client = await HelperClient.start({ debug: true });
    try {
        const ping = await client.ping();
        log(`ping ok, version=${ping.version}`);

        const existing = await client.appList();
        const stale = existing.filter((w) => w.title.includes("Clock"));
        for (const w of stale) {
            log(`closing existing Clock pid=${w.pid}`);
            await client.appKill({ pid: w.pid });
        }
        if (stale.length) {
            await sleep(1500);
        }

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        log(`launched pid=${launch.pid} mainWindow=${launch.mainWindow}`);

        // Poll until the UWP tree populates with at least a few invokable buttons.
        let tree = await client.treeDump({ root: launch.mainWindow, maxDepth: 6 });
        let attempts = 0;
        while (countInvocableButtons(tree) < 3 && attempts < 10) {
            await sleep(500);
            tree = await client.treeDump({ root: launch.mainWindow, maxDepth: 6 });
            attempts++;
        }
        log(
            `tree settled after ${attempts} polls: ${countNodes(tree)} nodes, ` +
                `${countInvocableButtons(tree)} invokable buttons`,
        );

        writeFileSync(
            path.join(fixturesDir, "clock-tree-launched.json"),
            JSON.stringify(tree, null, 2),
        );
        log("saved clock-tree-launched.json");

        const shot = await client.screenshot({ root: launch.mainWindow });
        writeFileSync(
            path.join(fixturesDir, "clock-launched.png"),
            Buffer.from(shot.pngBase64, "base64"),
        );
        log(`saved clock-launched.png (${shot.rect.width}x${shot.rect.height})`);

        // Pick a target for do.invoke. Prefer Close so we leave the system clean.
        const target = findInvocable(tree, "Close ") ?? findInvocable(tree);
        if (!target) {
            throw new Error("no invokable element found in Clock tree");
        }
        log(`do.invoke target: ${target.selector}`);
        await client.doInvoke({ selector: target.selector });
        await sleep(800);

        // If Close was invoked, Clock is gone. Try kill anyway as belt-and-suspenders.
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
