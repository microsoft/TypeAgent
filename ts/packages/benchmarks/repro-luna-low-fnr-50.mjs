#!/usr/bin/env node
// Run from ts/packages/benchmarks after pnpm build.
// Calls the TypeAgent translator only; it never executes returned actions.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
    initRuntimeConfigFromProcessEnv,
    withLlmCallTrace,
} from "@typeagent/aiclient";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import {
    closeCommandHandlerContext,
    createChatHistory,
    createHistoryContext,
    initializeCommandHandlerContext,
    translateRequest,
} from "agent-dispatcher/internal";
import {
    createTranslationBenchConfig,
    getDefaultTranslationBenchScenario,
} from "./dist/translationBench/runner/runner.js";

const require = createRequire(import.meta.url);
const MODEL = "azure/gpt-5.6-luna";
const CONCURRENCY = 6;
const GOLD_ACTION_LIST_PATH = new URL(
    "./src/translationBench/eligible-gold-actions.generated.json",
    import.meta.url,
);
const CASES = [
    ["Please display the image file \"team-photo.jpg\".", "chat.showImageFile"],
    ["Split the active editor showing server.js to the right.", "code.splitEditor"],
    ["Please close the editor pane I'm looking at.", "code.code-display.closeEditor"],
    ["Open the editor's Markdown preview for the file I'm on in the current tab, not in a side pane.", "code.code-display.openMarkdownPreview"],
    ["In the editor, open this Markdown file's preview to the side.", "code.code-display.openMarkdownPreviewToSide"],
    ["Open the Explorer sidebar in the editor.", "code.code-display.showExplorer"],
    ["Open the Output panel.", "code.code-display.showOutputPanel"],
    ["Open the find bar in the editor so I can search this file.", "code.code-display.showSearch"],
    ["Open the Source Control view in the editor.", "code.code-display.showSourceControl"],
    ["Please switch the editor into Zen Mode.", "code.code-display.zenMode"],
    ["Please reload the VS Code window.", "code.code-extension.reloadWindow"],
    ["Show VS Code's Keyboard Shortcuts panel.", "code.code-general.showKeyboardShortcuts"],
    ["In VS Code, open the file server.ts by exact name, only among .ts files, and don't look in generated output folders.", "code.code-workbench.workbenchOpenFile"],
    ["The screen is too bright for this room—turn the display brightness down.", "desktop.AdjustScreenBrightness"],
    ["Set my Windows theme to MidnightBlue using C:\\Users\\Maya\\Downloads\\MidnightBlue.theme.", "desktop.ApplyTheme"],
    ["Please turn Bluetooth on for me.", "desktop.BluetoothToggle"],
    ["Please turn Wi‑Fi back on for this laptop.", "desktop.EnableWifi"],
    ["Please make the Windows text larger for menus and title bars only—set text size to 135%, not the overall display scale.", "desktop.SetTextSize"],
    ["Please turn on airplane mode on this PC.", "desktop.ToggleAirplaneMode"],
    ["Please turn off desktop notifications for now.", "desktop.ToggleNotifications"],
    ["That's great! How about turning on the screen magnifier for me?", "desktop.desktop-system.EnableMagnifier"],
    ["Set repeat to this song only.", "localPlayer.repeat"],
    ["In the Windows Clock app, start my focus session now.", "windowsClock.setFocusSessionRunning"],
    ["Please start the stopwatch in Clock.", "windowsClock.setStopwatchRunning"],
    ["Switch the timer to compact view.", "windowsClock.setTimerViewMode"],
    ["Please display the image files beach-sunrise.jpg and boardwalk-night.png.", "chat.showImageFile"],
    ["Please switch my editor theme to \"Solarized Dark\".", "code.changeColorScheme"],
    ["Switch the editor layout to two columns.", "code.changeEditorLayout"],
    ["Could you split the last editor that's showing server.js over to the left?", "code.splitEditor"],
    ["Open the preview for this Markdown file in the current editor pane.", "code.code-display.openMarkdownPreview"],
    ["Open the Markdown preview to the side in the editor for the file I'm viewing.", "code.code-display.openMarkdownPreviewToSide"],
    ["Thanks — now bring up the Settings window in VS Code.", "code.code-display.openSettings"],
    ["Show the Explorer pane in my editor.", "code.code-display.showExplorer"],
    ["Open the Output panel so I can inspect the build logs.", "code.code-display.showOutputPanel"],
    ["Open the Find box so I can search for text in the current file.", "code.code-display.showSearch"],
    ["In the code editor, can you now show the Source Control sidebar?", "code.code-display.showSourceControl"],
    ["Could you switch the editor into Zen Mode now?", "code.code-display.zenMode"],
    ["VS Code is acting weird after that extension change—reload the window for me.", "code.code-extension.reloadWindow"],
    ["Go to line 128.", "code.code-general.gotoFileOrLineOrSymbol"],
    ["Open the Keyboard Shortcuts panel in VS Code.", "code.code-general.showKeyboardShortcuts"],
    ["Please raise the screen brightness a notch.", "desktop.AdjustScreenBrightness"],
    ["Go back to the theme I was using before.", "desktop.ApplyTheme"],
    ["Set the Windows accessibility text size setting to 125%, and do not change display scaling, resolution, or any app zoom.", "desktop.SetTextSize"],
    ["Turn on airplane mode on this computer.", "desktop.ToggleAirplaneMode"],
    ["Please turn off desktop notifications for me.", "desktop.ToggleNotifications"],
    ["Make the mouse pointer bigger so it's easier to see on this monitor.", "desktop.desktop-input.AdjustMousePointerSize"],
    ["Turn on Filter Keys so the keyboard ignores brief or repeated key presses.", "desktop.desktop-system.EnableFilterKeysAction"],
    ["Set quiet hours from 10 PM until 6 AM every night.", "desktop.desktop-system.EnableQuietHours"],
    ["Please turn on the setting that minimizes my windows when a monitor gets disconnected.", "desktop.desktop-system.MinimizeWindowsOnMonitorDisconnectAction"],
    ["Please log me out of GitHub on ghe.acme.internal.", "github-cli.authLogout"],
].map(([utterance, expected]) => ({ utterance, expected }));
const HISTORY_BY_UTTERANCE = new Map([
    [
        "Open the find bar in the editor so I can search this file.",
        [{
            assistant: {
                source: "code.code-display",
                text: "I can help with editor display controls for searching within the open file.",
            },
            user: "I'm trying to locate a specific phrase in the code I'm viewing.",
        }],
    ],
    [
        "Thanks — now bring up the Settings window in VS Code.",
        [{
            assistant: { source: "code.code-display", text: "Sure — I can help with that." },
            user: "Could you zoom the editor in a bit?",
        }],
    ],
]);
for (const testCase of CASES) testCase.history = HISTORY_BY_UTTERANCE.get(testCase.utterance);

if (CASES.length !== 50) throw new Error(`Expected 50 cases; got ${CASES.length}`);

function configureModel() {
    const key = process.env.OPENAI_API_KEY ?? process.env.LOCAL_LITELLM_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY or LOCAL_LITELLM_API_KEY is required");
    const base = (process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:4627/v1").replace(/\/$/, "");
    process.env.OPENAI_API_KEY = key;
    process.env.OPENAI_ENDPOINT = `${base}/chat/completions`;
    process.env.OPENAI_MODEL = MODEL;
    process.env.OPENAI_MODEL_WIRE_API = JSON.stringify({ [MODEL]: "responses" });
    initRuntimeConfigFromProcessEnv();
}

function createGoldProvider(base, allowlist) {
    const configs = new Map();
    const schemaFiles = new Map();
    for (const config of base.getActionConfigs()) {
        if (![...allowlist].some((id) => id.startsWith(`${config.schemaName}.`))) continue;
        const source = base.getActionSchemaFileForConfig(config);
        const actionSchemas = new Map(
            [...source.parsedActionSchema.actionSchemas].filter(([actionName]) =>
                allowlist.has(`${config.schemaName}.${actionName}`),
            ),
        );
        if (actionSchemas.size === 0) continue;
        configs.set(config.schemaName, config);
        schemaFiles.set(config.schemaName, {
            ...source,
            sourceHash: `${source.sourceHash}+gold:${allowlist.size}`,
            parsedActionSchema: { ...source.parsedActionSchema, actionSchemas },
        });
    }
    return {
        tryGetActionConfig: (name) => configs.get(name),
        getActionConfig(name) {
            const config = configs.get(name);
            if (!config) throw new Error(`Unknown gold schema: ${name}`);
            return config;
        },
        getActionConfigs: () => [...configs.values()],
        getActionSchemaFileForConfig: (config) => schemaFiles.get(config.schemaName),
    };
}

function createEvalActionContext(live, config, provider, historyInput) {
    const session = new Proxy(live.session, {
        get(target, property) {
            if (property === "getConfig") return () => config;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const agents = new Proxy(live.agents, {
        get(target, property) {
            if (property === "getActionConfig") {
                return (name) => provider.tryGetActionConfig(name) ?? target.getActionConfig(name);
            }
            if (property === "tryGetActionConfig") {
                return (name) => provider.tryGetActionConfig(name) ?? target.tryGetActionConfig(name);
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const chatHistory = createChatHistory(true);
    if (historyInput !== undefined) chatHistory.import(historyInput);
    return {
        streamingContext: undefined,
        activityContext: undefined,
        actionIO: {
            setDisplay() {},
            appendDisplay() {},
            takeAction() {},
            appendDiagnosticData() {},
        },
        sessionContext: {
            agentContext: {
                ...live,
                session,
                agents,
                chatHistory,
                activityContext: undefined,
                lastActionSchemaName: "",
                pendingTopicalRoute: undefined,
                translatorCache: new Map(),
            },
            sessionStorage: undefined,
            instanceStorage: undefined,
            notify() {},
            addAgentNameTag: false,
        },
        queuedToggleTransientAgent: async () => {},
    };
}

function format(actions) {
    return actions.length === 0
        ? "(no action)"
        : actions.map((action) => `${action.schemaName}.${action.actionName}`).join(" + ");
}

async function mapConcurrent(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: limit }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}

configureModel();
const instanceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-luna-low-fnr-"));
const { getDefaultDispatcherOptions } = require("default-agent-provider");
const context = await initializeCommandHandlerContext("luna-low-fnr-repro", {
    ...getDefaultDispatcherOptions(),
    appAgentProviders: getDefaultAppAgentProviders(instanceDir),
    explanationAsynchronousMode: false,
    persistSession: false,
    metrics: false,
    explainer: { enabled: false },
});

try {
    const goldActionList = JSON.parse(fs.readFileSync(GOLD_ACTION_LIST_PATH, "utf8")).allowlist;
    if (!Array.isArray(goldActionList)) throw new Error("Gold action JSON must contain an allowlist array");
    const goldAllowlist = new Set(goldActionList);
    const provider = createGoldProvider(context.agents, goldAllowlist);
    const activeSchemas = provider.getActionConfigs().map((item) => item.schemaName);
    const scenario = { ...getDefaultTranslationBenchScenario(), reasoningEffort: "low" };
    const config = createTranslationBenchConfig(context.session.getConfig(), MODEL, scenario);

    console.log(`model=${MODEL} effort=low cases=${CASES.length} concurrency=${CONCURRENCY} goldActions=${goldAllowlist.size}`);
    const results = await mapConcurrent(CASES, CONCURRENCY, async (testCase) => {
        const calls = [];
        try {
            let result;
            let lastError;
            for (let attempt = 1; attempt <= 4; attempt++) {
                const actionContext = createEvalActionContext(context, config, provider, testCase.history);
                const history = testCase.history === undefined
                    ? undefined
                    : createHistoryContext(actionContext.sessionContext.agentContext);
                try {
                    result = await withLlmCallTrace(calls, () =>
                        translateRequest(
                            actionContext,
                            testCase.utterance,
                            history,
                            undefined,
                            undefined,
                            activeSchemas,
                            () => {},
                            undefined,
                            provider,
                        ),
                    );
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
                }
            }
            if (result === undefined) throw lastError;
            if (calls.length === 0) throw new Error("Translator made no model call");
            const actions = result.requestAction.actions
                .map((entry) => entry.action)
                .filter((action) => goldAllowlist.has(`${action.schemaName}.${action.actionName}`));
            const routed = actions.some((action) => `${action.schemaName}.${action.actionName}` === testCase.expected);
            return { ...testCase, actual: format(actions), routed, error: undefined };
        } catch (error) {
            return { ...testCase, actual: "(error)", routed: false, error: error.message };
        }
    });

    const errors = results.filter((result) => result.error !== undefined);
    const misses = results.filter((result) => !result.routed && result.error === undefined);
    for (const result of errors) {
        console.log(`\n${result.utterance}`);
        console.log(`error: ${result.error}`);
    }
    for (const result of misses) {
        console.log(`\n${result.utterance}`);
        console.log(`expected: ${result.expected}`);
        console.log(`actual:   ${result.actual}`);
    }
    console.log(`\nFNR: ${misses.length}/${CASES.length - errors.length} successful translations = ${(100 * misses.length / (CASES.length - errors.length)).toFixed(1)}%`);
    console.log(`translation errors: ${errors.length}`);
    if (errors.length > 0) process.exitCode = 1;
} finally {
    await closeCommandHandlerContext(context);
    fs.rmSync(instanceDir, { recursive: true, force: true });
}
