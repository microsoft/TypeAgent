// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { StudioRuntime } from "./studioRuntimeCore.js";
import {
    summarizeAgentHealth,
    type HealthSummaryLevel,
} from "./healthStatusPresentation.js";

/** Command run when the status-bar item is clicked. */
export const STUDIO_STATUS_BAR_COMMAND = "typeagent-studio.focusSandboxes";

/**
 * Thin VS Code adapter that renders an agent-health summary in the status bar.
 * Aggregation/labelling lives in the vscode-free `healthStatusPresentation`
 * module; this class owns the `StatusBarItem` lifecycle and refresh wiring.
 */
export class StudioStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly subscription: { dispose(): void };

    constructor(private readonly runtime: StudioRuntime) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100,
        );
        this.item.command = STUDIO_STATUS_BAR_COMMAND;
        this.subscription = runtime.onSandboxChanged(() => {
            void this.refresh();
        });
        void this.refresh();
        this.item.show();
    }

    async refresh(): Promise<void> {
        const summary = summarizeAgentHealth(
            await this.runtime.listSandboxes(),
        );
        this.item.text = `$(${summary.icon}) ${summary.label}`;
        this.item.tooltip = summary.tooltip;
        this.item.backgroundColor = backgroundForLevel(summary.level);
    }

    dispose(): void {
        this.subscription.dispose();
        this.item.dispose();
    }
}

function backgroundForLevel(
    level: HealthSummaryLevel,
): vscode.ThemeColor | undefined {
    switch (level) {
        case "error":
            return new vscode.ThemeColor("statusBarItem.errorBackground");
        case "warning":
            return new vscode.ThemeColor("statusBarItem.warningBackground");
        default:
            return undefined;
    }
}
