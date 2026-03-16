// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { type ActionContext, type ActionResult } from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import { type CommandHandlerContext } from "../context/commandHandlerContext.js";
import { executeAction } from "./actionHandlers.js";
import { toExecutableActions } from "agent-cache";
import type { FullAction, ParamObjectType } from "agent-cache";

// ── Flow definition types ────────────────────────────────────────────────────

export type FlowParameterDef = {
    type: "string" | "number" | "boolean";
    required?: boolean;
    default?: unknown;
    description?: string;
};

export type ActionStepDef = {
    id: string;
    type?: undefined; // absent or undefined for action steps
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
};

export type ScriptStepDef = {
    id: string;
    type: "script";
    language: "powershell";
    body: string;
    parameters: Record<string, unknown>;
    sandbox: {
        allowedCmdlets: string[];
        allowedPaths: string[];
        maxExecutionTime: number;
        networkAccess: boolean;
    };
};

export type FlowStepDef = ActionStepDef | ScriptStepDef;

export type FlowDefinition = {
    // Matches the actionName in userActions.mts (used as the dispatch key)
    name: string;
    description: string;
    parameters: Record<string, FlowParameterDef>;
    steps: FlowStepDef[];
};

// ── Step result ──────────────────────────────────────────────────────────────

type FlowStepResult = {
    actionResult: ActionResult;
    // Plain text extracted from the ActionResult (for ${stepId.text})
    text: string;
    // historyText parsed as JSON if valid, else the raw text (for ${stepId.data})
    data: unknown;
};

// ── Text extraction from ActionResult ────────────────────────────────────────

function extractText(result: ActionResult): string {
    if (result.error !== undefined) return `Error: ${result.error}`;
    const hist = result.historyText;
    if (hist !== undefined) return hist;
    const dc = result.displayContent;
    if (dc === undefined) return "";
    if (typeof dc === "string") return dc;
    if (Array.isArray(dc)) return (dc as string[]).join("\n");
    // TypedDisplayContent
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

// ── Parameter resolution ─────────────────────────────────────────────────────

function resolveRef(
    ref: string,
    flowParams: Record<string, unknown>,
    stepResults: Map<string, FlowStepResult>,
): unknown {
    const dot = ref.indexOf(".");
    if (dot !== -1) {
        const stepId = ref.substring(0, dot);
        const rest = ref.substring(dot + 1);
        const sr = stepResults.get(stepId);
        if (sr !== undefined) {
            if (rest === "text") return sr.text;
            if (rest === "data") return sr.data;
            // Handle nested property access: ${stepId.data.prop} or ${stepId.data.prop.nested}
            if (rest.startsWith("data.")) {
                let value: unknown = sr.data;
                for (const key of rest.substring(5).split(".")) {
                    if (
                        value === null ||
                        value === undefined ||
                        typeof value !== "object"
                    ) {
                        return undefined;
                    }
                    value = (value as Record<string, unknown>)[key];
                }
                return value;
            }
        }
        return undefined;
    }
    return flowParams[ref];
}

function resolveValue(
    value: unknown,
    flowParams: Record<string, unknown>,
    stepResults: Map<string, FlowStepResult>,
): unknown {
    if (typeof value === "string") {
        // Pure reference: entire value is a single ${...} — returns the typed value
        const pure = value.match(/^\$\{([^}]+)\}$/);
        if (pure) {
            return resolveRef(pure[1], flowParams, stepResults);
        }
        // Template string: interpolate ${...} occurrences into a string
        return value.replace(/\$\{([^}]+)\}/g, (_, ref) => {
            const resolved = resolveRef(ref, flowParams, stepResults);
            return resolved !== undefined ? String(resolved) : `\${${ref}}`;
        });
    }
    // Recursively resolve arrays (e.g. to: ["${recipient}"])
    if (Array.isArray(value)) {
        return value.map((item) => resolveValue(item, flowParams, stepResults));
    }
    // Recursively resolve plain objects (e.g. messageRef: { receivedDateTime: { dayRange: "${timePeriod}" } })
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [
                k,
                resolveValue(v, flowParams, stepResults),
            ]),
        );
    }
    return value;
}

function resolveParams(
    template: Record<string, unknown>,
    flowParams: Record<string, unknown>,
    stepResults: Map<string, FlowStepResult>,
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(template).map(([k, v]) => [
            k,
            resolveValue(v, flowParams, stepResults),
        ]),
    );
}

// ── Script step execution ────────────────────────────────────────────────

async function executeScriptStep(
    step: ScriptStepDef,
    resolvedParams: Record<string, unknown>,
): Promise<ActionResult> {
    if (process.platform !== "win32") {
        return createActionResultFromError(
            "Script execution is only supported on Windows",
        );
    }

    try {
        const { spawn } = await import("child_process");

        // Inject parameters as PowerShell variable assignments (safe: values are single-quoted and escaped)
        const paramAssignments = Object.entries(resolvedParams)
            .map(
                ([k, v]) =>
                    `$${k} = '${String(v ?? "").replace(/'/g, "''")}'`,
            )
            .join("; ");
        const fullScript = paramAssignments
            ? `${paramAssignments}; ${step.body}`
            : step.body;

        const result = await new Promise<{
            success: boolean;
            stdout: string;
            stderr: string;
        }>((resolve) => {
            const child = spawn(
                "powershell",
                ["-NoProfile", "-Command", fullScript],
                { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
            );

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (d: Buffer) => {
                stdout += d.toString();
            });
            child.stderr.on("data", (d: Buffer) => {
                stderr += d.toString();
            });

            const timeout = setTimeout(() => {
                child.kill();
                resolve({ success: false, stdout, stderr: `Timed out after ${step.sandbox.maxExecutionTime}s` });
            }, step.sandbox.maxExecutionTime * 1000);

            child.on("close", (code) => {
                clearTimeout(timeout);
                resolve({ success: code === 0, stdout, stderr });
            });

            child.on("error", (err) => {
                clearTimeout(timeout);
                resolve({ success: false, stdout, stderr: err.message });
            });
        });

        if (result.success) {
            return createActionResultFromTextDisplay(result.stdout.trim());
        } else {
            return createActionResultFromError(
                result.stderr || "Script execution failed",
            );
        }
    } catch (error) {
        return createActionResultFromError(
            `Script execution error: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// ── processFlow ──────────────────────────────────────────────────────────────

/**
 * Execute a registered flow program step-by-step.
 *
 * Runs entirely within the existing commandLock — each step calls executeAction()
 * directly (no re-entrant lock acquisition). Steps are sequential; each step's
 * result is available to subsequent steps via ${stepId.text} and ${stepId.data}.
 *
 * @param flowDef       The loaded flow definition (from manifest)
 * @param flowParams    Parameters from the matched flow action (genre, quantity, …)
 * @param context       The outer ActionContext (carries CommandHandlerContext)
 * @param actionIndex   The action index from the outer executeAction call
 */
export async function processFlow(
    flowDef: FlowDefinition,
    flowParams: Record<string, unknown>,
    context: ActionContext<CommandHandlerContext>,
    actionIndex: number,
): Promise<ActionResult> {
    // Apply parameter defaults for any values not supplied by the grammar match
    for (const [name, def] of Object.entries(flowDef.parameters)) {
        if (!(name in flowParams) && def.default !== undefined) {
            flowParams[name] = def.default;
        }
    }

    const stepResults = new Map<string, FlowStepResult>();
    let stepIndex = actionIndex + 1;

    for (const step of flowDef.steps) {
        const params = resolveParams(step.parameters, flowParams, stepResults);

        let result: ActionResult;

        if (step.type === "script") {
            // Script step — execute via PowerShell runner
            displayStatus(
                `[flow:${flowDef.name}] ${step.id}: powershell script`,
                context,
            );

            result = await executeScriptStep(step, params);
        } else {
            // Action step — delegate to agent action execution
            displayStatus(
                `[flow:${flowDef.name}] ${step.id}: ${step.schemaName}.${step.actionName}`,
                context,
            );

            const action: FullAction = {
                schemaName: step.schemaName,
                actionName: step.actionName,
                parameters: params as ParamObjectType,
            };

            const [executableAction] = toExecutableActions([action]);
            result = await executeAction(
                executableAction,
                context,
                stepIndex,
            );
        }

        const text = extractText(result);
        const data = tryParseJson(text) ?? text;
        stepResults.set(step.id, { actionResult: result, text, data });

        if (result.error !== undefined) {
            return createActionResultFromError(
                `Flow '${flowDef.name}' failed at step '${step.id}': ${result.error}`,
            );
        }

        stepIndex++;
    }

    if (flowDef.steps.length === 0) {
        return createActionResultFromTextDisplay(
            `Flow '${flowDef.name}' has no steps.`,
        );
    }

    const lastStep = flowDef.steps[flowDef.steps.length - 1];
    return stepResults.get(lastStep.id)!.actionResult;
}
