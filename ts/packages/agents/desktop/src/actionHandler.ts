// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResult,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import {
    AutoShellMissingError,
    buildAutoShell,
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
        async handleChoice(
            choiceId: string,
            response: boolean | number[],
            context: ActionContext<DesktopActionContext>,
        ) {
            return context.sessionContext.agentContext.choiceManager.handleChoice(
                choiceId,
                response,
            );
        },
    };
}

async function initializeDesktopContext(): Promise<DesktopActionContext> {
    return {
        desktopProcess: undefined,
        programNameIndex: undefined,
        backupProgramNameTable: undefined,
        refreshPromise: undefined,
        abortRefresh: undefined,
        choiceManager: new ChoiceManager(),
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

async function runAction(
    action: AppAction,
    context: ActionContext<DesktopActionContext>,
): Promise<ActionResult> {
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

function offerAutoShellBuild(
    context: ActionContext<DesktopActionContext>,
    error: AutoShellMissingError,
    action: AppAction,
): ActionResult {
    const state = context.sessionContext.agentContext;
    return createYesNoChoiceResult(
        state.choiceManager,
        `The desktop automation helper (autoShell.exe) isn't built yet (expected at ${error.binaryPath}). ` +
            `Build it now? This runs 'dotnet build -c Release' on autoShell.sln and may take ~30s.`,
        async (confirmed: boolean) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "autoShell build skipped — action cancelled.",
                );
            }
            try {
                await buildAutoShell();
            } catch (buildError) {
                return createActionResultFromError(
                    `autoShell build failed: ${buildError instanceof Error ? buildError.message : String(buildError)}`,
                );
            }
            try {
                return await runAction(action, context);
            } catch (e) {
                return createActionResultFromError(
                    e instanceof Error ? e.message : String(e),
                );
            }
        },
    );
}

async function executeDesktopAction(
    action: AppAction,
    context: ActionContext<DesktopActionContext>,
) {
    try {
        return await runAction(action, context);
    } catch (e) {
        if (e instanceof AutoShellMissingError) {
            return offerAutoShellBuild(context, e, action);
        }
        throw e;
    }
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
