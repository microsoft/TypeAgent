// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    disableDesktopActionContext,
    DesktopActionContext,
    runDesktopActions,
    setupDesktopActionContext,
} from "./connector.js";
import { AllDesktopActions } from "./allActionsSchema.js";
export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeDesktopContext,
        updateAgentContext: updateDesktopContext,
        executeAction: executeDesktopAction,
    };
}

async function initializeDesktopContext(): Promise<DesktopActionContext> {
    return {
        desktopProcess: undefined,
        programNameIndex: undefined,
        backupProgramNameTable: undefined,
        refreshPromise: undefined,
        abortRefresh: undefined,
    };
}

async function updateDesktopContext(
    enable: boolean,
    context: SessionContext<DesktopActionContext>,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        await setupDesktopActionContext(agentContext, context.instanceStorage);
    } else {
        await disableDesktopActionContext(agentContext);
    }
}

async function executeDesktopAction(
    action: AppAction,
    context: ActionContext<DesktopActionContext>,
) {
    const result = await runDesktopActions(
        action as AllDesktopActions,
        context.sessionContext.agentContext,
        context.sessionContext.sessionStorage!,
        action.schemaName, // Pass schema name for disambiguation
    );
    if (result.success) {
        const displayText = formatResultDisplay(
            action.actionName,
            result.message,
            result.data,
        );
        return createActionResult(displayText);
    }
    return { error: result.message };
}

function formatResultDisplay(
    actionName: string,
    message: string,
    data?: unknown,
): string {
    if (data === undefined || data === null) {
        return message;
    }
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return message;
        }
        const formatter = itemFormatters[actionName] ?? defaultItemFormatter;
        const lines = data.map((item) => `  - ${formatter(item)}`);
        return `${message}:\n${lines.join("\n")}`;
    }
    if (typeof data === "object") {
        return `${message}:\n${JSON.stringify(data, null, 2)}`;
    }
    return `${message}: ${data}`;
}

function defaultItemFormatter(item: unknown): string {
    if (typeof item !== "object" || item === null) {
        return String(item);
    }
    return Object.values(item).join(", ");
}

const itemFormatters: Record<string, (item: unknown) => string> = {
    ListWifiNetworks: (item) => {
        const n = item as Record<string, unknown>;
        const signal = n.signalQuality ?? "?";
        const secured = n.secured ? "🔒" : "🔓";
        const connected = n.connected ? " (connected)" : "";
        return `${n.ssid} — ${signal}% ${secured}${connected}`;
    },
    ListResolutions: (item) => {
        const r = item as Record<string, unknown>;
        return `${r.width}x${r.height} @ ${r.refreshRate}Hz`;
    },
};
