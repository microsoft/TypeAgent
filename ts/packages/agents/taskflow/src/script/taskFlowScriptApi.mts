// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { type ActionContext, type ActionResult } from "@typeagent/agent-sdk";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { ActionStepResult } from "./types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TaskFlowScriptAPI {
    callAction(
        schemaName: string,
        actionName: string,
        params: Record<string, unknown>,
    ): Promise<ActionStepResult>;

    queryLLM(
        prompt: string,
        options?: { input?: string; parseJson?: boolean; model?: string },
    ): Promise<ActionStepResult>;

    webSearch(query: string): Promise<ActionStepResult>;

    webFetch(url: string): Promise<ActionStepResult>;
}

// ── Text extraction from ActionResult ────────────────────────────────────────

function extractText(result: ActionResult): string {
    if (result.error !== undefined) return `Error: ${result.error}`;
    const hist = result.historyText;
    if (hist !== undefined) return hist;
    const dc = result.displayContent;
    if (dc === undefined) return "";
    if (typeof dc === "string") return dc;
    if (Array.isArray(dc)) return (dc as string[]).join("\n");
    const typed = dc as { type?: string; content?: unknown };
    if (typed.type === "text" || typed.type === "markdown") {
        const c = typed.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.join("\n");
    }
    return "";
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// ── Dynamic import cache ─────────────────────────────────────────────────────

let _dispatcherModule: {
    executeAction: (
        action: any,
        context: ActionContext<any>,
        actionIndex: number,
    ) => Promise<ActionResult>;
} | null = null;

async function getDispatcherModule() {
    if (_dispatcherModule) return _dispatcherModule;

    const tsRoot = join(__dirname, "..", "..", "..", "..", "..");
    const actionHandlersPath = join(
        tsRoot,
        "packages",
        "dispatcher",
        "dispatcher",
        "dist",
        "execute",
        "actionHandlers.js",
    );

    if (!existsSync(actionHandlersPath)) {
        throw new Error(
            `Dispatcher actionHandlers not found at ${actionHandlersPath}. Ensure the dispatcher is built.`,
        );
    }

    _dispatcherModule = await import(
        /* webpackIgnore: true */ "file://" +
            actionHandlersPath.replace(/\\/g, "/")
    );
    return _dispatcherModule!;
}

function toExecutableAction(
    schemaName: string,
    actionName: string,
    parameters: Record<string, unknown>,
) {
    return {
        action: { schemaName, actionName, parameters },
    };
}

// ── Implementation ───────────────────────────────────────────────────────────

export class TaskFlowScriptAPIImpl implements TaskFlowScriptAPI {
    private stepIndex: number;

    constructor(
        private context: ActionContext<any>,
        initialStepIndex: number = 1,
    ) {
        this.stepIndex = initialStepIndex;
    }

    async callAction(
        schemaName: string,
        actionName: string,
        params: Record<string, unknown>,
    ): Promise<ActionStepResult> {
        const systemContext = this.context.sessionContext.agentContext as any;
        systemContext.currentAbortSignal?.throwIfAborted();

        const { executeAction } = await getDispatcherModule();

        const executableAction = toExecutableAction(
            schemaName,
            actionName,
            params,
        );
        const result = await executeAction(
            executableAction,
            this.context,
            this.stepIndex++,
        );

        const text = extractText(result);
        const data = tryParseJson(text) ?? text;

        if (result.error) {
            return { text, data, error: result.error };
        }
        return { text, data };
    }

    async queryLLM(
        prompt: string,
        options?: { input?: string; parseJson?: boolean; model?: string },
    ): Promise<ActionStepResult> {
        return this.callAction("utility", "llmTransform", {
            prompt,
            ...options,
        });
    }

    async webSearch(query: string): Promise<ActionStepResult> {
        return this.callAction("utility", "webSearch", { query });
    }

    async webFetch(url: string): Promise<ActionStepResult> {
        return this.callAction("utility", "webFetch", { url });
    }
}
