#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Run from ts/packages/benchmarks after pnpm build.
// This calls the TypeAgent translator only. It does not execute any action.

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
    initializeCommandHandlerContext,
    translateRequest,
} from "agent-dispatcher/internal";
import {
    createTranslationBenchConfig,
    filterParsedActionSchemaToGoldAllowlist,
    getDefaultTranslationBenchScenario,
} from "./dist/translationBench/runner/runner.js";

const require = createRequire(import.meta.url);
const MODEL = "azure/gpt-5.4-nano";
const GOLD_ACTION_LIST_PATH = new URL(
    "./src/translationBench/eligible-gold-actions.generated.json",
    import.meta.url,
);
const CASES = [
    {
        utterance: "Don't go forward.",
        expected: [],
        previouslyRecorded: "browser.goBack()",
    },
    {
        utterance: "Don't read this page.",
        expected: [],
        previouslyRecorded: "browser.stopReadPageContent()",
    },
    {
        utterance: "Don't set any breakpoint anywhere in the code.",
        expected: [],
        previouslyRecorded: "code.code-debug.removeAllBreakpoints()",
    },
    {
        utterance: "Don't enable automatic date and time.",
        expected: [],
        previouslyRecorded:
            "desktop.desktop-system.AutomaticTimeSettingAction(enableAutoTimeSync=false)",
    },
    {
        utterance: "Don't enable Filter Keys.",
        expected: [],
        previouslyRecorded:
            "desktop.desktop-system.EnableFilterKeysAction(enable=false)",
    },
];
function configureModel() {
    const base = process.env.OPENAI_BASE_URL;
    if (!base) throw new Error("OPENAI_BASE_URL is required");
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required");
    }
    // TypeAgent's OpenAI adapter expects the complete chat endpoint.
    process.env.OPENAI_ENDPOINT = `${base.replace(/\/$/, "")}/chat/completions`;
    process.env.OPENAI_MODEL = MODEL;
    initRuntimeConfigFromProcessEnv();
}

function createGoldProvider(base, allowlist) {
    const configs = new Map();
    const schemaFiles = new Map();
    for (const config of base.getActionConfigs()) {
        if (
            ![...allowlist].some((id) => id.startsWith(`${config.schemaName}.`))
        ) {
            continue;
        }
        const source = base.getActionSchemaFileForConfig(config);
        const parsed = filterParsedActionSchemaToGoldAllowlist(
            source.parsedActionSchema,
            config.schemaName,
            allowlist,
        );
        if (!parsed) continue;
        configs.set(config.schemaName, config);
        schemaFiles.set(config.schemaName, {
            ...source,
            sourceHash: `${source.sourceHash}+gold:${allowlist.size}`,
            parsedActionSchema: parsed,
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
        getActionSchemaFileForConfig: (config) =>
            schemaFiles.get(config.schemaName),
    };
}

function format(actions) {
    if (actions.length === 0) return "(no action)";
    return actions
        .map((action) => {
            const id = `${action.schemaName}.${action.actionName}`;
            const entries = Object.entries(action.parameters ?? {});
            return entries.length === 0
                ? `${id}()`
                : `${id}(${entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",")})`;
        })
        .join(" + ");
}

function createEvalActionContext(live, config, historyInput) {
    const session = new Proxy(live.session, {
        get(target, property) {
            if (property === "getConfig") return () => config;
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

configureModel();
const instanceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-fpr-"));
const { getDefaultDispatcherOptions } = require("default-agent-provider");
const context = await initializeCommandHandlerContext("negative-fpr-repro", {
    ...getDefaultDispatcherOptions(),
    appAgentProviders: getDefaultAppAgentProviders(instanceDir),
    explanationAsynchronousMode: false,
    persistSession: false,
    metrics: false,
    explainer: { enabled: false },
});

const goldActionList = JSON.parse(
    fs.readFileSync(GOLD_ACTION_LIST_PATH, "utf8"),
).allowlist;
if (!Array.isArray(goldActionList)) {
    throw new Error("Gold action JSON must contain an allowlist array");
}
const goldAllowlist = new Set(goldActionList);
const provider = createGoldProvider(context.agents, goldAllowlist);
const activeSchemas = provider
    .getActionConfigs()
    .map((item) => item.schemaName);
const scenario = getDefaultTranslationBenchScenario();
const config = createTranslationBenchConfig(
    context.session.getConfig(),
    MODEL,
    scenario,
);

let fired = 0;
let translated = 0;
try {
    console.log(
        `model=${MODEL} cases=${CASES.length} goldActions=${goldAllowlist.size}`,
    );
    for (const testCase of CASES) {
        if (testCase.expected.length !== 0 || !testCase.previouslyRecorded) {
            throw new Error(
                "Each case must have empty gold and a recorded output",
            );
        }
        const actionContext = createEvalActionContext(
            context,
            config,
            undefined,
        );
        const history = undefined;
        const calls = [];
        let result;
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
        } catch (error) {
            console.log(`\n${testCase.utterance}`);
            console.log("expected:            (no action)");
            console.log(`previously recorded: ${testCase.previouslyRecorded}`);
            console.log(`live:                error: ${error.message}`);
            continue;
        }
        if (calls.length === 0)
            throw new Error("Translator made no model call");
        translated++;
        const actions = result.requestAction.actions
            .map((entry) => entry.action)
            .filter((action) =>
                goldAllowlist.has(`${action.schemaName}.${action.actionName}`),
            );
        if (actions.length > 0) fired++;
        console.log(`\n${testCase.utterance}`);
        console.log("expected:            (no action)");
        console.log(`previously recorded: ${testCase.previouslyRecorded}`);
        console.log(`live:                ${format(actions)}`);
    }
    const rate = translated === 0 ? 0 : (100 * fired) / translated;
    console.log(
        `\nFPR: ${fired}/${translated} successful translations = ${rate.toFixed(1)}%`,
    );
    console.log(`translation errors: ${CASES.length - translated}`);
} finally {
    await closeCommandHandlerContext(context);
    fs.rmSync(instanceDir, { recursive: true, force: true });
}
