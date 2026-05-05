// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// One-shot: scaffold a runtime agent for Windows Clock from the workspace's
// discoveredActions.json into ts/packages/agents/windowsClock/.

import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scaffoldUiAgent } from "../scaffoldUiAgent.js";

const __filename = fileURLToPath(import.meta.url);

function log(msg: string): void {
    process.stdout.write(`[scaffold] ${msg}\n`);
}

function main(): void {
    // From dist/uiCapture/test/scaffoldClockAgent.js, six levels up is ts/.
    const tsRoot = path.resolve(
        path.dirname(__filename),
        "../../../../../..",
    );
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "windowsClock",
    );
    const discoveredActionsPath = path.join(
        workspaceDir,
        "discoveredActions.json",
    );
    const targetDir = path.join(
        tsRoot,
        "packages",
        "agents",
        "windowsClock",
    );

    log(`source: ${discoveredActionsPath}`);
    log(`target: ${targetDir}`);

    scaffoldUiAgent({
        discoveredActionsPath,
        targetDir,
        integrationName: "windowsClock",
        description:
            "Windows Clock agent — set alarms, start timers, run the stopwatch, and add world clocks via the built-in Windows Alarms & Clock app.",
        emoji: "⏰",
        appLaunch: { aumid: "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App" },
        appTitleMatch: "Clock",
    });
    log("DONE");
}

main();
