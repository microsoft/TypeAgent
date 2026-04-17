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
        const displayText = formatResultDisplay(result.message, result.data);
        return createActionResult(displayText);
    }
    return { error: result.message };
}

function formatResultDisplay(message: string, data?: unknown): string {
    if (data === undefined || data === null) {
        return message;
    }
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return message;
        }
        const lines = data.map((item) => `  - ${formatItem(item)}`);
        return `${message}:\n${lines.join("\n")}`;
    }
    if (typeof data === "object") {
        return `${message}:\n${JSON.stringify(data, null, 2)}`;
    }
    return `${message}: ${data}`;
}

function formatItem(item: unknown): string {
    if (typeof item !== "object" || item === null) {
        return String(item);
    }
    const obj = item as Record<string, unknown>;

    // WiFi network: { ssid, signalQuality, secured, connected }
    if ("ssid" in obj || "Ssid" in obj) {
        const ssid = obj.ssid ?? obj.Ssid;
        const signal = obj.signalQuality ?? obj.SignalQuality ?? "?";
        const secured = (obj.secured ?? obj.Secured) ? "🔒" : "🔓";
        const connected = (obj.connected ?? obj.Connected) ? " (connected)" : "";
        return `${ssid} — ${signal}% ${secured}${connected}`;
    }

    // Display resolution: { width, height, bitsPerPixel, refreshRate }
    if (("width" in obj || "Width" in obj) && ("refreshRate" in obj || "RefreshRate" in obj)) {
        const w = obj.width ?? obj.Width;
        const h = obj.height ?? obj.Height;
        const hz = obj.refreshRate ?? obj.RefreshRate;
        return `${w}x${h} @ ${hz}Hz`;
    }

    return Object.values(obj).join(", ");
}
