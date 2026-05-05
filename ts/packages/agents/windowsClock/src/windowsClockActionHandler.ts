// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    executePlayback,
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
    const launch = await client.appLaunch({ aumid: "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App" });
    state.appPid = launch.pid;
    state.appMainWindow = launch.mainWindow;
    await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });
}

export function instantiate(): AppAgent {
    return {
        async initializeAgentContext() {
            return {
                client: null,
                appPid: null,
                appMainWindow: null,
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
                await ensureAppRunning(state);
                const client = await ensureClient(state);
                const result = await executePlayback(
                    def,
                    (action.parameters ?? {}) as Record<
                        string,
                        string | number | boolean
                    >,
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
            } catch (e) {
                return createActionResultFromError(
                    e instanceof Error ? e.message : String(e),
                );
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
