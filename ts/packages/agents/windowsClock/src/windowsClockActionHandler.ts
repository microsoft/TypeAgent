// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import {
    displayStatus,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import {
    buildHelperBinary,
    executePlayback,
    HelperBinaryMissingError,
    HelperClient,
    SynthesizedAction,
} from "onboarding-agent/uiCapture";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WindowsClockAction } from "./windowsClockSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_TITLE_MATCH = "Clock";

type DiscoveredActionsFile = { actions: SynthesizedAction[] };

let cachedActions: DiscoveredActionsFile | null = null;
function loadDiscoveredActions(): DiscoveredActionsFile {
    if (cachedActions) return cachedActions;
    // From dist/windowsClockActionHandler.js, the data dir is two levels up + /data/.
    const file = path.resolve(
        __dirname,
        "..",
        "data",
        "discoveredActions.json",
    );
    cachedActions = JSON.parse(
        readFileSync(file, "utf8"),
    ) as DiscoveredActionsFile;
    return cachedActions;
}

type AgentState = {
    client: HelperClient | null;
    appPid: number | null;
    appMainWindow: string | null;
    choiceManager: ChoiceManager;
    pendingChoiceContext: ActionContext<AgentState> | null;
};

async function ensureClient(state: AgentState): Promise<HelperClient> {
    if (!state.client) {
        state.client = await HelperClient.start();
    }
    return state.client;
}

async function ensureAppRunning(state: AgentState): Promise<void> {
    const client = await ensureClient(state);
    if (state.appPid !== null) {
        // Verify still running.
        const list = await client.appList();
        const found = list.find((w) => w.pid === state.appPid);
        if (found) {
            state.appMainWindow = found.mainWindow;
            return;
        }
        state.appPid = null;
        state.appMainWindow = null;
    }
    // The app may already be running from a prior invocation (each CLI / agent
    // call gets a fresh AgentState). Probe app.list for an existing window
    // matching APP_TITLE_MATCH before launching — UWP apps can't be launched
    // twice and FlaUI returns "no main window" when they are.
    const existing = await client.appList();
    const match = existing.find((w) =>
        w.title.toLowerCase().includes(APP_TITLE_MATCH.toLowerCase()),
    );
    if (match) {
        state.appPid = match.pid;
        state.appMainWindow = match.mainWindow;
        await client.eventsIdle({ debounceMs: 600, maxWaitMs: 3000 });
        return;
    }
    const launch = await client.appLaunch({
        aumid: "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App",
    });
    state.appPid = launch.pid;
    state.appMainWindow = launch.mainWindow;
    await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
}

function navigateActionForTab(tab: string): SynthesizedAction | undefined {
    const name = "navigateTo" + tab.charAt(0).toUpperCase() + tab.slice(1);
    return loadDiscoveredActions().actions.find((a) => a.actionName === name);
}

function tabFromNeutralState(neutralState: string | undefined): string | null {
    if (!neutralState) return null;
    const first = neutralState.split(".")[0];
    return first.endsWith("Tab") ? first : null;
}

async function ensureOnRequiredTab(
    state: AgentState,
    def: SynthesizedAction,
): Promise<void> {
    if (def.actionName.startsWith("navigateTo")) {
        return;
    }
    const tab = tabFromNeutralState(def.preconditions?.neutralState);
    if (!tab) {
        return;
    }
    const nav = navigateActionForTab(tab);
    if (!nav) {
        return;
    }
    const client = await ensureClient(state);
    await executePlayback(
        nav,
        {},
        {
            client,
            defaultIdleDebounceMs: 700,
            defaultIdleMaxWaitMs: 4000,
        },
    );
}

async function runPlayback(
    state: AgentState,
    action: TypeAgentAction<WindowsClockAction>,
    def: SynthesizedAction,
): Promise<ActionResult> {
    await ensureAppRunning(state);
    await ensureOnRequiredTab(state, def);
    const client = await ensureClient(state);
    const result = await executePlayback(
        def,
        (action.parameters ?? {}) as Record<string, string | number | boolean>,
        {
            client,
            defaultIdleDebounceMs: 700,
            defaultIdleMaxWaitMs: 4000,
        },
    );
    if (!result.success) {
        const failed = result.steps[result.failedAtStep ?? 0];
        return createActionResultFromError(
            `Playback failed at step ${(result.failedAtStep ?? 0) + 1}: ${failed?.errorMessage ?? "unknown"}`,
        );
    }
    return createActionResultFromTextDisplay(
        `Done: ${action.actionName} (${result.steps.length} steps)`,
    );
}

function offerHelperBuild(
    state: AgentState,
    error: HelperBinaryMissingError,
    action: TypeAgentAction<WindowsClockAction>,
    def: SynthesizedAction,
): ActionResult {
    return createYesNoChoiceResult(
        state.choiceManager,
        `The Windows Clock UI Automation helper isn't built yet (expected at ${error.binaryPath}). ` +
            `Build it now? This runs 'dotnet build -c Release' on UiAutomationHelper.sln and may take ~30s.`,
        async (confirmed: boolean) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Helper build skipped — action cancelled.",
                );
            }
            const ctx = state.pendingChoiceContext;
            try {
                if (ctx) {
                    await displayStatus(
                        "Building UI Automation helper (dotnet build -c Release)...",
                        ctx,
                    );
                }
                let lastUpdate = 0;
                await buildHelperBinary({
                    onProgress: (chunk) => {
                        if (!ctx) return;
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
                                `Building UI Automation helper: ${last.slice(0, 100)}`,
                                ctx,
                            );
                        }
                    },
                });
            } catch (buildError) {
                return createActionResultFromError(
                    `Helper build failed: ${buildError instanceof Error ? buildError.message : String(buildError)}`,
                );
            }
            if (ctx) {
                await displaySuccess(
                    "UI Automation helper built. Running your action...",
                    ctx,
                );
            }
            try {
                return await runPlayback(state, action, def);
            } catch (e) {
                return createActionResultFromError(
                    e instanceof Error ? e.message : String(e),
                );
            }
        },
    );
}

export function instantiate(): AppAgent {
    return {
        async initializeAgentContext() {
            return {
                client: null,
                appPid: null,
                appMainWindow: null,
                choiceManager: new ChoiceManager(),
                pendingChoiceContext: null,
            } as AgentState;
        },
        async updateAgentContext(
            _enable: boolean,
            _context: SessionContext<AgentState>,
            _schemaName: string,
        ) {
            // No per-session work needed; the helper is launched lazily.
        },
        async executeAction(
            action: TypeAgentAction<WindowsClockAction>,
            context: ActionContext<AgentState>,
        ) {
            const state = context.sessionContext.agentContext;
            const def = loadDiscoveredActions().actions.find(
                (a) => a.actionName === action.actionName,
            );
            if (!def) {
                return createActionResultFromError(
                    `No discovered action named '${action.actionName}'`,
                );
            }
            try {
                return await runPlayback(state, action, def);
            } catch (e) {
                if (e instanceof HelperBinaryMissingError) {
                    return offerHelperBuild(state, e, action, def);
                }
                return createActionResultFromError(
                    e instanceof Error ? e.message : String(e),
                );
            }
        },
        async handleChoice(
            choiceId: string,
            response: boolean | number[],
            context: ActionContext<AgentState>,
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
        async closeAgentContext(context: SessionContext<AgentState>) {
            const state = context.agentContext;
            if (state.client) {
                await state.client.dispose();
                state.client = null;
            }
        },
    };
}
