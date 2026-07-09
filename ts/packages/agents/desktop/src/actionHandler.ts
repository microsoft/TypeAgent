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
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import {
    AutoShellMissingError,
    buildAutoShell,
    disableDesktopActionContext,
    DesktopActionContext,
    runDesktopActions,
    setupDesktopActionContext,
} from "./connector.js";
import { AllDesktopActions } from "./allActionsSchema.js";
import { checkDesktopReadiness, setupDesktop } from "./readiness.js";
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
            const state = context.sessionContext.agentContext;
            state.pendingChoiceContext = context;
            try {
                return await state.choiceManager.handleChoice(
                    choiceId,
                    response,
                    context,
                );
            } finally {
                state.pendingChoiceContext = null;
            }
        },
        checkReadiness: checkDesktopReadiness,
        setup: setupDesktop,
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
        pendingChoiceContext: null,
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
        if (isServiceConfirmationRequest(result.data)) {
            return offerServiceConfirmation(context, action, result.data);
        }
        const displayText = formatResultDisplay(
            action.actionName,
            result.message,
            result.data,
        );
        return createActionResult(displayText);
    }
    return { error: result.message };
}

// Shape of the confirmation payload emitted by autoShell when a service action
// resolves to a fuzzy (non-exact) match and needs the user to confirm the target.
type ServiceConfirmationData = {
    needsConfirmation: true;
    resolvedServiceName: string;
    resolvedDisplayName: string;
    operation?: string;
};

function isServiceConfirmationRequest(
    data: unknown,
): data is ServiceConfirmationData {
    if (typeof data !== "object" || data === null) {
        return false;
    }
    const d = data as Record<string, unknown>;
    return (
        d.needsConfirmation === true &&
        typeof d.resolvedServiceName === "string" &&
        typeof d.resolvedDisplayName === "string"
    );
}

// When autoShell only fuzzily matches a service, ask the user to confirm the resolved
// service before acting. On confirmation, re-run the original action targeting the
// resolved service by its exact name — which matches exactly, so autoShell performs the
// operation without prompting again.
function offerServiceConfirmation(
    context: ActionContext<DesktopActionContext>,
    action: AppAction,
    data: ServiceConfirmationData,
): ActionResult {
    const state = context.sessionContext.agentContext;
    const operation = data.operation ?? "restart";
    const requested = action.parameters?.service;
    const query = typeof requested === "string" ? requested : "";
    return createYesNoChoiceResult(
        state.choiceManager,
        `I couldn't find a service exactly matching "${query}". ` +
            `The closest match is "${data.resolvedDisplayName}" (${data.resolvedServiceName}). ` +
            `Should I ${operation} it?`,
        async (confirmed: boolean) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Cancelled — no service was changed.",
                );
            }
            const ctx = state.pendingChoiceContext ?? context;
            const confirmedAction: AppAction = {
                ...action,
                parameters: {
                    ...action.parameters,
                    service: data.resolvedServiceName,
                    matchBy: "name",
                },
            };
            try {
                return await runAction(confirmedAction, ctx);
            } catch (e) {
                if (e instanceof AutoShellMissingError) {
                    return offerAutoShellBuild(ctx, e, confirmedAction);
                }
                return createActionResultFromError(
                    e instanceof Error ? e.message : String(e),
                );
            }
        },
    );
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
            const ctx = state.pendingChoiceContext ?? context;
            try {
                await displayStatus(
                    "Building desktop automation helper (dotnet build -c Release)...",
                    ctx,
                );
                let lastUpdate = 0;
                await buildAutoShell({
                    onProgress: (chunk) => {
                        const now = Date.now();
                        if (now - lastUpdate < 1000) return;
                        lastUpdate = now;
                        const last = chunk
                            .split(/\r?\n/)
                            .map((l) => l.trim())
                            .filter(Boolean)
                            .pop();
                        if (last) {
                            void displayStatus(
                                `Building desktop helper: ${last.slice(0, 100)}`,
                                ctx,
                            );
                        }
                    },
                });
            } catch (buildError) {
                return createActionResultFromError(
                    `autoShell build failed: ${buildError instanceof Error ? buildError.message : String(buildError)}`,
                );
            }
            await displaySuccess(
                "Desktop helper built. Running your action...",
                ctx,
            );
            try {
                return await runAction(action, ctx);
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
    // Per-request token-usage accumulator. The only model calls reachable
    // from here are text-embedding lookups (programNameIndex app-name
    // matching). aiclient's TextEmbeddingModel doesn't expose token usage
    // (no completionCallback; the API's usage is discarded internally), so
    // this stays all-zero. Reporting it instead of leaving it undefined
    // signals the agent ran but consumed no reportable LLM tokens.
    const tokenUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    };
    try {
        const result = await runAction(action, context);
        // Attach usage to success results only; error results carry none.
        if (result.error === undefined) {
            result.tokenUsage = tokenUsage;
        }
        return result;
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
