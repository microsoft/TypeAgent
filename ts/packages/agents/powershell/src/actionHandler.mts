// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type AppAction,
    type SessionContext,
    type ActionContext,
    type ActionResult,
    type SchemaContent,
    type GrammarContent,
    AppAgentEvent,
} from "@typeagent/agent-sdk";
import {
    createActionResultNoDisplay,
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    type CommandHandler,
    type CommandHandlerNoParams,
    type CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import type { ParsedCommandParams } from "@typeagent/agent-sdk";
import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname, isAbsolute, resolve, extname } from "path";
import { ScriptAnalyzer } from "./analysis/scriptAnalyzer.mjs";
import { fileURLToPath } from "url";
import { PowerShellStore } from "./store/powerShellStore.mjs";
import type { PowerShellFlowDefinition } from "./store/powerShellStore.mjs";
import {
    createEditedScriptSource,
    getScriptExecutionProvenance,
    getRequiredModules,
    type ScriptRecipe,
    type ScriptParameter,
} from "./types/scriptRecipe.js";
import {
    executeScript,
    type ScriptExecutionRequest,
    type ScriptExecutionResult,
    type ScriptParameterRole,
} from "./execution/powershellRunner.mjs";
import {
    revokeScriptApprovals,
    closeScriptApprovals,
    scriptApprovalStatus,
} from "./execution/scriptApproval.mjs";
import {
    createPowerShellRevision,
    matchesPowerShellRevision,
    PowerShellIntegrityError,
} from "@typeagent/agent-flows/powershell/integrity";
import {
    createPowerShellExecutionFailure,
    createPowerShellFailure,
} from "./types/powerShellFailure.mjs";
import type { PowerShellAgentContext } from "./types/powerShellAgentContext.mjs";
import { executeNamespaceAction } from "./namespaces/actionHandlerRegistry.mjs";
import type { PowerShellAction } from "./namespaces/namespaceActionHandler.mjs";
import {
    getPowerShellExecutionGates,
    isDynamicPowerShellExecutionEnabled,
} from "./config/executionGates.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:powershell:handler");
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "samples");

const flowMutationTails = new Map<string, Promise<void>>();
const repairAttempts = new WeakSet<object>();

function createDynamicExecutionDenied(): ActionResult {
    return createPowerShellFailure(
        "policyDenied",
        "Dynamic PowerShell execution is disabled by policy.",
        { retryable: false },
    );
}

async function withFlowMutationLock<T>(
    flowName: string,
    operation: () => Promise<T>,
): Promise<T> {
    const previous = flowMutationTails.get(flowName) ?? Promise.resolve();
    let release: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    flowMutationTails.set(flowName, tail);
    await previous;
    try {
        return await operation();
    } finally {
        release!();
        if (flowMutationTails.get(flowName) === tail) {
            flowMutationTails.delete(flowName);
        }
    }
}

async function seedSampleFlows(store: PowerShellStore): Promise<number> {
    let seeded = 0;
    let sampleFiles: string[];
    try {
        sampleFiles = readdirSync(SAMPLES_DIR).filter((f) =>
            f.endsWith(".recipe.json"),
        );
    } catch {
        debug("No samples directory found");
        return 0;
    }

    for (const file of sampleFiles) {
        const recipe: ScriptRecipe = JSON.parse(
            readFileSync(join(SAMPLES_DIR, file), "utf8"),
        );

        if (store.hasFlow(recipe.actionName)) continue;
        if (store.isSampleDeleted(recipe.actionName)) continue;

        await store.saveFlow(recipe, "seed");
        seeded++;
    }

    if (seeded > 0) {
        debug(`Seeded ${seeded} sample flow(s)`);
    }
    return seeded;
}

async function executeFlowScript(
    flow: PowerShellFlowDefinition,
    script: string,
    parameters: Record<string, unknown>,
    context: ActionContext<PowerShellAgentContext>,
    flowName: string,
    store: PowerShellStore,
): Promise<ActionResult> {
    if (!isDynamicPowerShellExecutionEnabled()) {
        return createDynamicExecutionDenied();
    }
    const snapshot = await store.getExecutionSnapshot(flowName);
    if (
        !snapshot ||
        !matchesPowerShellRevision(
            snapshot.revision,
            createPowerShellRevision(script, flow),
        )
    ) {
        throw new PowerShellIntegrityError(
            "PowerShell changed before execution was prepared.",
        );
    }
    const requiredModules = getRequiredModules(flow);

    const resolvedParams: Record<string, unknown> = {};
    for (const paramDef of flow.parameters) {
        let value = parameters[paramDef.name] ?? paramDef.default;
        if (
            paramDef.type === "boolean" &&
            typeof value === "string" &&
            /^(true|false)$/i.test(value)
        ) {
            value = value.toLowerCase() === "true";
        }
        if (value !== undefined) {
            resolvedParams[paramDef.name] = value;
        }
    }

    const request: ScriptExecutionRequest = {
        script,
        parameters: resolvedParams,
        provenance: getScriptExecutionProvenance(flow.source),
        parameterRoles: getScriptParameterRoles(flow.parameters),
        sandbox: {
            maxExecutionTime: flow.sandbox.maxExecutionTime,
        },
        abortSignal: context.abortSignal,
        profiler: context.profiler,
        requiredModules,
        revisionStatus: snapshot.revisionStatus,
        onAuthorized: snapshot.acceptRevision,
    };

    const result = await executeScript(request, {
        sessionContext: context.sessionContext,
        definition: { ...flow, requiredModules, actionName: flowName },
        allowSessionReuse:
            context.executionOrigin === "direct-user" &&
            context.isFromReasoningLoop !== true &&
            context.sessionContext.currentConnectionId !== undefined,
    });
    if (result.cancelled) {
        context.abortSignal?.throwIfAborted();
    }

    if (result.success) {
        const output = executionOutput(result);
        return createActionResultFromTextDisplay(output);
    }

    return createPowerShellExecutionFailure(result);
}

function executionOutput(result: ScriptExecutionResult): string {
    const output = result.stdout.trim() || "(no output)";
    return result.stderr.trim()
        ? `${output}\n\nNative command warnings:\n${result.stderr.trim()}`
        : output;
}

function getScriptParameterRoles(
    paramDefs: ScriptParameter[],
): Record<string, ScriptParameterRole> {
    return Object.fromEntries(
        paramDefs
            .filter(
                (
                    parameter,
                ): parameter is ScriptParameter & {
                    type: ScriptParameterRole;
                } =>
                    parameter.type === "path" ||
                    parameter.type === "executable",
            )
            .map((parameter) => [parameter.name, parameter.type]),
    );
}

function mapParamsToFlowDefs(
    provided: Record<string, unknown>,
    paramDefs: ScriptParameter[],
    out: Record<string, unknown>,
): void {
    const defsByLower = new Map(
        paramDefs.map((d) => [d.name.toLowerCase(), d.name]),
    );
    for (const [key, value] of Object.entries(provided)) {
        const actualName = defsByLower.get(key.toLowerCase());
        if (actualName) {
            out[actualName] = value;
        } else {
            // No matching param def — pass through as-is, the script may still accept it
            out[key] = value;
            debug(
                `Parameter '${key}' not found in flow definition, passing through`,
            );
        }
    }
}

function validateFlowParameters(
    params: Record<string, unknown>,
    paramDefs: ScriptParameter[],
): string | undefined {
    const pathAliases = new Map([
        ["USERPROFILE", homedir()],
        ["HOME", homedir()],
        ["TEMP", tmpdir()],
        ["TMP", tmpdir()],
        ["PWD", process.cwd()],
    ]);
    for (const def of paramDefs) {
        if (def.type !== "path" && def.type !== "executable") continue;
        const value = params[def.name];
        if (typeof value !== "string" || !/\$env:/i.test(value)) continue;
        const expanded = value.replace(
            /\$env:(\w+)/gi,
            (match, name: string) =>
                pathAliases.get(name.toUpperCase()) ?? match,
        );
        if (/\$env:/i.test(expanded)) {
            return `Parameter '${def.name}' uses an unsupported environment variable. Supported path aliases: USERPROFILE, HOME, TEMP, TMP, PWD.`;
        }
        params[def.name] = expanded;
    }
    return (
        validatePathParameters(params, paramDefs) ??
        validateParameterRules(params, paramDefs)
    );
}

function validatePathParameters(
    params: Record<string, unknown>,
    paramDefs: ScriptParameter[],
): string | undefined {
    for (const def of paramDefs) {
        if (def.type !== "path" && def.type !== "executable") continue;
        const val = params[def.name];
        if (val === undefined || val === "") continue;
        if (typeof val !== "string") {
            return `Parameter '${def.name}' must be a string path, got ${typeof val}`;
        }
        // Reject values that contain natural language (spaces + non-path words)
        if (/\b(and|or|show|with|the|ones|that|filter|find)\b/i.test(val)) {
            return `Parameter '${def.name}' contains non-path text: "${val}". Extract the path separately from the rest of the request.`;
        }
        // Check for obviously invalid path characters
        if (/[<>"|?*]/.test(val.replace(/^[a-zA-Z]:\\/, ""))) {
            return `Parameter '${def.name}' contains invalid path characters: "${val}"`;
        }

        // Enforce pathMustExist validation rule
        if (def.validation?.pathMustExist) {
            if (isAbsolute(val) && !existsSync(val)) {
                return `Parameter '${def.name}' path does not exist: "${val}" (pathMustExist validation rule)`;
            }
        } else {
            // Just warn if the path doesn't exist (for absolute paths)
            if (isAbsolute(val) && !existsSync(val)) {
                debug(`Path parameter '${def.name}' does not exist: ${val}`);
            }
        }
    }
    return undefined;
}

function validateParameterRules(
    params: Record<string, unknown>,
    paramDefs: ScriptParameter[],
): string | undefined {
    for (const def of paramDefs) {
        const val = params[def.name];

        // Skip validation if parameter not provided and not required
        if (val === undefined && !def.required) continue;

        // Validate pattern (regex)
        if (def.validation?.pattern && typeof val === "string") {
            try {
                const regex = new RegExp(def.validation.pattern);
                if (!regex.test(val)) {
                    return `Parameter '${def.name}' value "${val}" does not match required pattern: ${def.validation.pattern}`;
                }
            } catch (err) {
                debug(
                    `Invalid regex pattern for parameter '${def.name}': ${def.validation.pattern}`,
                );
            }
        }

        // Validate allowedValues (enum)
        if (
            def.validation?.allowedValues &&
            def.validation.allowedValues.length > 0
        ) {
            const strVal = String(val);
            if (!def.validation.allowedValues.includes(strVal)) {
                return `Parameter '${def.name}' value "${val}" is not in allowed values: ${def.validation.allowedValues.join(", ")}`;
            }
        }
    }
    return undefined;
}

type FlowGrammarPatternInput = {
    pattern: string;
    isAlias?: boolean;
};

async function validateFlowGrammarPatterns(
    actionName: string,
    description: string,
    grammarPatterns: FlowGrammarPatternInput[],
    context: ActionContext<PowerShellAgentContext>,
): Promise<{ patterns: FlowGrammarPatternInput[] } | { error: ActionResult }> {
    if (
        grammarPatterns.length === 0 ||
        !context.sessionContext.validateGrammarPatterns
    ) {
        return { patterns: grammarPatterns };
    }

    const validationResult =
        await context.sessionContext.validateGrammarPatterns({
            actionName,
            description,
            patterns: grammarPatterns.map((pattern) => pattern.pattern),
        });
    if (!validationResult.approved) {
        const message = [
            "Grammar pattern validation failed:",
            ...(validationResult.errors ?? []),
            ...(validationResult.suggestions?.length
                ? ["Suggestions:", ...validationResult.suggestions]
                : []),
        ].join("\n");
        return {
            error: createPowerShellFailure("policyDenied", message, {
                retryable: false,
            }),
        };
    }

    if (validationResult.warnings?.length) {
        context.sessionContext.notify(
            AppAgentEvent.Warning,
            `Pattern validation warnings:\n${validationResult.warnings.join("\n")}`,
        );
    }

    return {
        patterns:
            validationResult.patterns?.map((pattern) => ({
                pattern,
                isAlias: false,
            })) ?? grammarPatterns,
    };
}

function buildPowerShellRecipe(
    params: Record<string, unknown>,
    grammarPatterns: FlowGrammarPatternInput[],
): ScriptRecipe {
    const actionName = params.actionName as string;
    const scriptParameters = (params.scriptParameters as any[]) ?? [];
    return {
        version: 1,
        actionName,
        description: (params.description as string) ?? "",
        displayName: (params.displayName as string) ?? actionName,
        parameters: scriptParameters.map((parameter: any) => ({
            name: parameter.name,
            type: parameter.type ?? "string",
            required: parameter.required ?? false,
            description: parameter.description ?? "",
            default: parameter.default,
        })),
        script: {
            language: "powershell",
            body: params.script as string,
            expectedOutputFormat: "text",
        },
        grammarPatterns: grammarPatterns.map((pattern) => ({
            pattern: pattern.pattern,
            isAlias: pattern.isAlias ?? false,
            examples: [],
        })),
        sandbox: {
            maxExecutionTime: 30,
        },
        requiredModules: getRequiredModules({
            sandbox: { maxExecutionTime: 30 },
            requiredModules: params.requiredModules as string[] | undefined,
        }),
        source: {
            type: "reasoning",
            timestamp: new Date().toISOString(),
        },
    };
}

function parseNamedParameters(
    value: unknown,
    parameterName: string,
): { parameters: Record<string, unknown> } | { error: ActionResult } {
    if (value === undefined) {
        return { parameters: {} };
    }
    if (typeof value !== "string") {
        return {
            error: createPowerShellFailure(
                "invalidParameters",
                `${parameterName} must be a JSON string`,
            ),
        };
    }
    try {
        const parsed = JSON.parse(value);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            throw new Error("expected a JSON object");
        }
        return { parameters: parsed as Record<string, unknown> };
    } catch (error) {
        return {
            error: createPowerShellFailure(
                "invalidParameters",
                `Invalid JSON in ${parameterName}: ${error instanceof Error ? error.message : String(error)}`,
            ),
        };
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createPostExecutionFailure(
    flowName: string,
    phase: string,
    error?: unknown,
): ActionResult {
    const detail = error === undefined ? "" : `: ${errorMessage(error)}`;
    return createPowerShellFailure(
        "partialSideEffects",
        `PowerShell flow '${flowName}' executed, but ${phase}${detail}. The operation may have caused side effects and was not executed again.`,
    );
}

function getPostExecutionCancellation(
    flowName: string,
    phase: string,
    abortSignal?: AbortSignal,
): ActionResult | undefined {
    if (!abortSignal?.aborted) {
        return undefined;
    }
    return createPostExecutionFailure(
        flowName,
        `the request was cancelled ${phase}`,
    );
}

async function recordUsageAfterExecution(
    flowStore: PowerShellStore,
    flowName: string,
    context: ActionContext<PowerShellAgentContext>,
): Promise<void> {
    try {
        await flowStore.recordUsage(flowName);
    } catch (error) {
        const message = `PowerShell flow '${flowName}' executed successfully, but usage accounting failed: ${errorMessage(error)}`;
        debug(message);
        context.sessionContext.notify(AppAgentEvent.Warning, message);
    }
}

async function executeDraftRecipe(
    recipe: ScriptRecipe,
    suppliedParameters: Record<string, unknown>,
    context: ActionContext<PowerShellAgentContext>,
): Promise<{ output: string } | { error: ActionResult }> {
    if (!isDynamicPowerShellExecutionEnabled()) {
        return { error: createDynamicExecutionDenied() };
    }

    const executionParameters: Record<string, unknown> = {};
    mapParamsToFlowDefs(
        suppliedParameters,
        recipe.parameters,
        executionParameters,
    );
    const validationError = validateFlowParameters(
        executionParameters,
        recipe.parameters,
    );
    if (validationError) {
        return {
            error: createPowerShellFailure(
                "invalidParameters",
                validationError,
            ),
        };
    }

    const result = await executeScript(
        {
            script: recipe.script.body,
            parameters: executionParameters,
            provenance: getScriptExecutionProvenance(recipe.source),
            parameterRoles: getScriptParameterRoles(recipe.parameters),
            sandbox: {
                maxExecutionTime: recipe.sandbox.maxExecutionTime,
            },
            abortSignal: context.abortSignal,
            profiler: context.profiler,
            requiredModules: getRequiredModules(recipe),
        },
        {
            sessionContext: context.sessionContext,
            definition: {
                ...recipe,
                requiredModules: getRequiredModules(recipe),
            },
        },
    );
    if (result.cancelled) {
        context.abortSignal?.throwIfAborted();
    }
    if (!result.success) {
        return {
            error: createPowerShellExecutionFailure(result),
        };
    }
    return { output: executionOutput(result) };
}

async function createOrReusePowerShellFlow(
    params: Record<string, unknown>,
    flowStore: PowerShellStore,
    context: ActionContext<PowerShellAgentContext>,
): Promise<ActionResult> {
    const actionName = params.actionName as string | undefined;
    const script = params.script as string | undefined;
    if (!actionName) {
        return createPowerShellFailure(
            "invalidParameters",
            "Missing required parameter: actionName",
        );
    }
    if (!script) {
        return createPowerShellFailure(
            "invalidParameters",
            "Missing required parameter: script",
        );
    }
    const executionParameters = parseNamedParameters(
        params.executionParametersJson,
        "executionParametersJson",
    );
    if ("error" in executionParameters) {
        return executionParameters.error;
    }

    return withFlowMutationLock(actionName, async () => {
        context.abortSignal?.throwIfAborted();
        const existing = await flowStore.getFlow(actionName);
        if (existing) {
            return executeExistingPowerShellFlow(
                actionName,
                existing,
                executionParameters.parameters,
                flowStore,
                context,
            );
        }

        const grammarValidation = await validateFlowGrammarPatterns(
            actionName,
            (params.description as string) ?? "",
            (params.grammarPatterns as FlowGrammarPatternInput[]) ?? [],
            context,
        );
        if ("error" in grammarValidation) {
            return grammarValidation.error;
        }
        const recipe = buildPowerShellRecipe(
            params,
            grammarValidation.patterns,
        );
        context.abortSignal?.throwIfAborted();
        const pendingId = await flowStore.savePending(recipe);
        const pendingFile = `${pendingId}.recipe.json`;
        let execution: Awaited<ReturnType<typeof executeDraftRecipe>>;
        try {
            execution = await executeDraftRecipe(
                recipe,
                executionParameters.parameters,
                context,
            );
        } catch (error) {
            await flowStore.deletePending(pendingFile);
            throw error;
        }
        if ("error" in execution) {
            await flowStore.deletePending(pendingFile);
            return execution.error;
        }

        const cancellation = getPostExecutionCancellation(
            actionName,
            "before the flow could be promoted",
            context.abortSignal,
        );
        if (cancellation) {
            await flowStore.deletePending(pendingFile);
            return cancellation;
        }

        let promoted: string | null;
        try {
            promoted = await flowStore.promotePending(pendingFile);
        } catch (error) {
            await flowStore.deletePending(pendingFile);
            return createPostExecutionFailure(
                actionName,
                "the flow could not be promoted",
                error,
            );
        }
        if (!promoted) {
            await flowStore.deletePending(pendingFile);
            return createPostExecutionFailure(
                actionName,
                "the flow could not be promoted because that name is already registered",
            );
        }
        try {
            const activationCancellation = getPostExecutionCancellation(
                actionName,
                "before the promoted flow could be activated",
                context.abortSignal,
            );
            if (activationCancellation) {
                await flowStore.deleteFlow(promoted);
                return activationCancellation;
            }
            await context.sessionContext.reloadAgentSchema();
            const completedCancellation = getPostExecutionCancellation(
                actionName,
                "after the flow was activated",
                context.abortSignal,
            );
            if (completedCancellation) {
                return completedCancellation;
            }
        } catch (error) {
            let cleanupError: unknown;
            try {
                await flowStore.deleteFlow(promoted);
            } catch (deleteError) {
                cleanupError = deleteError;
            }
            const cleanupDetail =
                cleanupError === undefined
                    ? ""
                    : ` Cleanup also failed: ${errorMessage(cleanupError)}.`;
            return createPostExecutionFailure(
                actionName,
                `the new flow could not be activated${cleanupDetail}`,
                error,
            );
        }

        return createActionResultFromTextDisplay(
            `${execution.output}\n\nCreated reusable PowerShell flow '${promoted}'.`,
        );
    });
}

async function executeExistingPowerShellFlow(
    flowName: string,
    flow: PowerShellFlowDefinition,
    suppliedParameters: Record<string, unknown>,
    flowStore: PowerShellStore,
    context: ActionContext<PowerShellAgentContext>,
): Promise<ActionResult> {
    const script = await flowStore.getScript(flowName);
    if (!script) {
        return createPowerShellFailure(
            "scriptFailure",
            `Script not found for flow: ${flowName}`,
        );
    }
    const mappedParameters: Record<string, unknown> = {};
    mapParamsToFlowDefs(suppliedParameters, flow.parameters, mappedParameters);
    const validationError = validateFlowParameters(
        mappedParameters,
        flow.parameters,
    );
    if (validationError) {
        return createPowerShellFailure("invalidParameters", validationError);
    }
    const result = await executeFlowScript(
        flow,
        script,
        mappedParameters,
        context,
        flowName,
        flowStore,
    );
    if (result.error === undefined) {
        await recordUsageAfterExecution(flowStore, flowName, context);
    }
    return result;
}

async function repairAndExecutePowerShellFlow(
    params: Record<string, unknown>,
    flowStore: PowerShellStore,
    context: ActionContext<PowerShellAgentContext>,
): Promise<ActionResult> {
    const flowName = params.flowName as string | undefined;
    const script = params.script as string | undefined;
    if (!flowName || !script) {
        return createPowerShellFailure(
            "invalidParameters",
            "Missing required parameter: flowName or script",
        );
    }
    const repairKey = context.abortSignal ?? context;
    if (repairAttempts.has(repairKey)) {
        return createPowerShellFailure(
            "policyDenied",
            "A PowerShell flow repair was already attempted for this request.",
            { retryable: false },
        );
    }
    repairAttempts.add(repairKey);
    const executionParameters = parseNamedParameters(
        params.executionParametersJson,
        "executionParametersJson",
    );
    if ("error" in executionParameters) {
        return executionParameters.error;
    }

    return withFlowMutationLock(flowName, async () => {
        context.abortSignal?.throwIfAborted();
        const existing = await flowStore.getFlow(flowName);
        const oldScript = await flowStore.getScript(flowName);
        if (!existing || !oldScript) {
            return createPowerShellFailure(
                "unknownFlow",
                `Unknown PowerShell flow '${flowName}'.`,
            );
        }
        const candidate: ScriptRecipe = {
            version: 1,
            actionName: existing.actionName,
            displayName: existing.displayName,
            description: existing.description,
            parameters: existing.parameters,
            script: {
                language: "powershell",
                body: script,
                expectedOutputFormat: existing.expectedOutputFormat,
            },
            grammarPatterns: existing.grammarPatterns,
            sandbox: {
                ...existing.sandbox,
            },
            requiredModules:
                params.requiredModules === undefined
                    ? getRequiredModules(existing)
                    : getRequiredModules({
                          sandbox: existing.sandbox,
                          requiredModules: params.requiredModules as string[],
                      }),
            source: createEditedScriptSource(existing.source),
        };
        const execution = await executeDraftRecipe(
            candidate,
            executionParameters.parameters,
            context,
        );
        if ("error" in execution) {
            return execution.error;
        }

        const updateCancellation = getPostExecutionCancellation(
            flowName,
            "before the repaired script could be saved",
            context.abortSignal,
        );
        if (updateCancellation) {
            return updateCancellation;
        }
        try {
            await flowStore.updateFlowScript(
                flowName,
                script,
                getRequiredModules(candidate),
                candidate.source,
            );
        } catch (error) {
            return createPostExecutionFailure(
                flowName,
                "the repaired script could not be saved",
                error,
            );
        }

        try {
            const activationCancellation = getPostExecutionCancellation(
                flowName,
                "before the repaired flow could be activated",
                context.abortSignal,
            );
            if (activationCancellation) {
                try {
                    await flowStore.updateFlowScript(
                        flowName,
                        oldScript,
                        getRequiredModules(existing),
                        existing.source,
                    );
                    return activationCancellation;
                } catch (restoreError) {
                    return createPostExecutionFailure(
                        flowName,
                        `the request was cancelled before the repaired flow could be activated, and restoring the previous flow failed: ${errorMessage(restoreError)}`,
                    );
                }
            }
            await context.sessionContext.reloadAgentSchema();
            const completedCancellation = getPostExecutionCancellation(
                flowName,
                "after the repaired flow was activated",
                context.abortSignal,
            );
            if (completedCancellation) {
                return completedCancellation;
            }
        } catch (error) {
            let restorationError: unknown;
            try {
                await flowStore.updateFlowScript(
                    flowName,
                    oldScript,
                    getRequiredModules(existing),
                    existing.source,
                );
            } catch (restoreError) {
                restorationError = restoreError;
            }
            const restorationDetail =
                restorationError === undefined
                    ? ""
                    : ` Restoring the previous flow also failed: ${errorMessage(restorationError)}.`;
            return createPostExecutionFailure(
                flowName,
                `the repaired flow could not be activated${restorationDetail}`,
                error,
            );
        }
        await recordUsageAfterExecution(flowStore, flowName, context);
        return createActionResultFromTextDisplay(
            `${execution.output}\n\nRepaired PowerShell flow '${flowName}' after one retry.`,
        );
    });
}

async function handlePowerShellFlowAction(
    action: PowerShellAction,
    context: ActionContext<PowerShellAgentContext>,
): Promise<ActionResult> {
    context.abortSignal?.throwIfAborted();
    const namespaceResult = await executeNamespaceAction(action, context);
    if (namespaceResult !== undefined) {
        return namespaceResult;
    }

    const flowStore = (context as any).__store as PowerShellStore | undefined;

    switch (action.actionName) {
        case "listPowerShellFlows": {
            if (!flowStore) {
                return createActionResultFromTextDisplay(
                    "Script flow store not available.",
                );
            }
            const entries = flowStore.listFlows();
            if (entries.length === 0) {
                return createActionResultFromTextDisplay(
                    "No PowerShell flows registered.",
                );
            }
            const lines = entries.map(
                (e) =>
                    `  - ${e.actionName}: ${e.description} [usage: ${e.usageCount}]${e.source === "seed" ? " (sample)" : ""}`,
            );
            return createActionResultFromTextDisplay(
                `Script flows (${entries.length}):\n${lines.join("\n")}`,
            );
        }

        case "deletePowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const name = action.parameters?.name as string | undefined;
            if (!name) {
                return createActionResultFromError(
                    "Missing required parameter: name",
                );
            }
            return withFlowMutationLock(name, async () => {
                const deleted = await flowStore.deleteFlow(name);
                if (!deleted) {
                    return createActionResultFromError(
                        `Script flow not found: ${name}`,
                    );
                }
                await context.sessionContext.reloadAgentSchema();
                return createActionResultFromTextDisplay(
                    `Deleted PowerShell flow: ${name}`,
                );
            });
        }

        case "createPowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const params = action.parameters as Record<string, unknown>;
            const newActionName = params.actionName as string;
            if (!newActionName) {
                return createActionResultFromError(
                    "Missing required parameter: actionName",
                );
            }
            if (flowStore.hasFlow(newActionName)) {
                return createActionResultFromError(
                    `A PowerShell flow named '${newActionName}' already exists. Reuse it or add grammar patterns instead of overwriting it.`,
                );
            }
            const scriptBody = params.script as string;
            if (!scriptBody) {
                return createActionResultFromError(
                    "Missing required parameter: script",
                );
            }
            const grammarValidation = await validateFlowGrammarPatterns(
                newActionName,
                (params.description as string) ?? "",
                (params.grammarPatterns as FlowGrammarPatternInput[]) ?? [],
                context,
            );
            if ("error" in grammarValidation) {
                return grammarValidation.error;
            }
            const recipe = buildPowerShellRecipe(
                params,
                grammarValidation.patterns,
            );

            return withFlowMutationLock(newActionName, async () => {
                if (flowStore.hasFlow(newActionName)) {
                    return createActionResultFromError(
                        `A PowerShell flow named '${newActionName}' already exists. Reuse it or add grammar patterns instead of overwriting it.`,
                    );
                }
                context.abortSignal?.throwIfAborted();
                await flowStore.saveFlow(recipe, "reasoning");
                try {
                    context.abortSignal?.throwIfAborted();
                    await context.sessionContext.reloadAgentSchema();
                } catch (error) {
                    await flowStore.deleteFlow(newActionName);
                    throw error;
                }
                return createActionResultFromTextDisplay(
                    `Created PowerShell flow '${newActionName}': ${recipe.description}`,
                );
            });
        }

        case "createAndExecutePowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            return createOrReusePowerShellFlow(
                action.parameters as Record<string, unknown>,
                flowStore,
                context,
            );
        }

        case "addPowerShellFlowPatterns": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const flowName = action.parameters?.flowName as string | undefined;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: flowName",
                );
            }
            return withFlowMutationLock(flowName, async () => {
                const flow = await flowStore.getFlow(flowName);
                if (!flow) {
                    return createActionResultFromError(
                        `Script flow not found: ${flowName}`,
                    );
                }
                const validation = await validateFlowGrammarPatterns(
                    flowName,
                    flow.description,
                    (action.parameters
                        ?.grammarPatterns as FlowGrammarPatternInput[]) ?? [],
                    context,
                );
                if ("error" in validation) {
                    return validation.error;
                }
                const previousPatterns = [...flow.grammarPatterns];
                const added = await flowStore.addGrammarPatterns(
                    flowName,
                    validation.patterns.map((pattern) => ({
                        pattern: pattern.pattern,
                        isAlias: true,
                        examples: [],
                    })),
                );
                if (added > 0) {
                    try {
                        await context.sessionContext.reloadAgentSchema();
                    } catch (error) {
                        try {
                            await flowStore.replaceGrammarPatterns(
                                flowName,
                                previousPatterns,
                            );
                            await context.sessionContext.reloadAgentSchema();
                        } catch (rollbackError) {
                            return createActionResultFromError(
                                `The grammar update failed and rollback also failed: ${errorMessage(rollbackError)}`,
                            );
                        }
                        return createActionResultFromError(
                            `No patterns were added because the updated PowerShell grammar could not be activated: ${errorMessage(error)}`,
                        );
                    }
                }
                return createActionResultFromTextDisplay(
                    added > 0
                        ? `Added ${added} grammar pattern(s) to PowerShell flow '${flowName}'.`
                        : `PowerShell flow '${flowName}' already contains those grammar patterns.`,
                );
            });
        }

        case "reportPowerShellCapabilityOutcome":
            return createActionResultNoDisplay(
                "PowerShell capability outcome reported.",
            );

        case "repairAndExecutePowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            return repairAndExecutePowerShellFlow(
                action.parameters as Record<string, unknown>,
                flowStore,
                context,
            );
        }

        case "editPowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const editFlowName = action.parameters?.flowName as
                | string
                | undefined;
            if (!editFlowName) {
                return createActionResultFromError(
                    "Missing required parameter: flowName",
                );
            }
            const newScript = action.parameters?.script as string | undefined;
            if (!newScript) {
                return createActionResultFromError(
                    "Missing required parameter: script",
                );
            }
            return withFlowMutationLock(editFlowName, async () => {
                const existingFlow = await flowStore.getFlow(editFlowName);
                if (!existingFlow) {
                    return createActionResultFromError(
                        `Script flow not found: ${editFlowName}`,
                    );
                }
                await flowStore.updateFlowScript(
                    editFlowName,
                    newScript,
                    action.parameters?.requiredModules as string[] | undefined,
                    createEditedScriptSource(existingFlow.source),
                );
                return createActionResultFromTextDisplay(
                    `Updated PowerShell flow '${editFlowName}'`,
                );
            });
        }

        case "testPowerShellFlow": {
            if (!isDynamicPowerShellExecutionEnabled()) {
                return createDynamicExecutionDenied();
            }

            // Execute a script without registering it (test-then-register pattern)
            const params = action.parameters as Record<string, unknown>;
            const scriptBody = params.script as string;
            if (!scriptBody) {
                return createActionResultFromError(
                    "Missing required parameter: script",
                );
            }

            const requiredModules = getRequiredModules({
                sandbox: { maxExecutionTime: 30 },
                requiredModules: params.requiredModules as string[] | undefined,
            });

            // Parse test parameters if provided
            let testParams: Record<string, unknown> = {};
            const testParamsJson = params.testParameters as string | undefined;
            if (testParamsJson) {
                try {
                    testParams = JSON.parse(testParamsJson);
                } catch {
                    return createActionResultFromError(
                        `Invalid JSON in testParameters: ${testParamsJson}`,
                    );
                }
            }

            // Approved-local tests require the same authorization as saved flows.
            const request: ScriptExecutionRequest = {
                script: scriptBody,
                parameters: testParams,
                provenance: "generated",
                sandbox: {
                    maxExecutionTime: 30,
                },
                abortSignal: context.abortSignal,
                profiler: context.profiler,
                requiredModules,
            };

            const result = await executeScript(request, {
                sessionContext: context.sessionContext,
                definition: {
                    actionName: "testPowerShellFlow",
                    displayName: "Unsaved PowerShell test",
                    description:
                        "Execute model-proposed code without registering a flow",
                    parameters: [],
                    grammarPatterns: [],
                    requiredModules,
                },
            });
            if (result.cancelled) {
                context.abortSignal?.throwIfAborted();
            }

            if (result.success) {
                const output = executionOutput(result);
                return createActionResultFromTextDisplay(
                    `Script test PASSED:\n${output}\n\nTo register this script, use createPowerShellFlow with the same script.`,
                );
            }

            return createPowerShellExecutionFailure(result);
        }

        case "executePowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const flowName = action.parameters?.flowName as string | undefined;
            if (!flowName) {
                return createActionResultFromError(
                    "Missing required parameter: flowName",
                );
            }

            const flow = await flowStore.getFlow(flowName);
            if (!flow) {
                return createPowerShellFailure(
                    "unknownFlow",
                    `Unknown PowerShell flow '${flowName}'. Use 'listPowerShellFlows' to see available flows.`,
                );
            }

            const script = await flowStore.getScript(flowName);
            if (!script) {
                return createActionResultFromError(
                    `Script not found for flow: ${flowName}`,
                );
            }

            // Prefer named flowParametersJson over single flowArgs string
            const flowParamsJson = action.parameters?.flowParametersJson as
                | string
                | undefined;
            let namedParams: Record<string, unknown> | undefined;
            if (flowParamsJson) {
                try {
                    namedParams = JSON.parse(flowParamsJson);
                } catch {
                    debug(
                        `Failed to parse flowParametersJson: ${flowParamsJson}`,
                    );
                }
            }
            const flowParameters: Record<string, unknown> = {};
            if (namedParams && Object.keys(namedParams).length > 0) {
                // Map provided param names to actual flow param names (case-insensitive)
                mapParamsToFlowDefs(
                    namedParams,
                    flow.parameters,
                    flowParameters,
                );
            } else {
                const flowArgs = action.parameters?.flowArgs as
                    | string
                    | undefined;
                if (flowArgs && flow.parameters.length > 0) {
                    flowParameters[flow.parameters[0].name] = flowArgs;
                }
            }

            const validationError = validateFlowParameters(
                flowParameters,
                flow.parameters,
            );
            if (validationError) {
                return createPowerShellFailure(
                    "invalidParameters",
                    validationError,
                );
            }

            const result = await executeFlowScript(
                flow,
                script,
                flowParameters,
                context,
                flowName,
                flowStore,
            );
            if (result.error !== undefined) {
                return result;
            }

            await recordUsageAfterExecution(flowStore, flowName, context);
            return result;
        }

        case "importPowerShellFlow": {
            if (!flowStore) {
                return createActionResultFromError(
                    "Script flow store not available",
                );
            }
            const importParams = action.parameters as Record<string, unknown>;
            const filePath = importParams?.filePath as string | undefined;
            if (!filePath) {
                return createActionResultFromError(
                    "Missing required parameter: filePath",
                );
            }

            const resolvedPath = isAbsolute(filePath)
                ? filePath
                : resolve(process.cwd(), filePath);

            if (!existsSync(resolvedPath)) {
                return createActionResultFromError(
                    `File not found: ${resolvedPath}`,
                );
            }

            if (extname(resolvedPath).toLowerCase() !== ".ps1") {
                return createActionResultFromError(
                    "Only PowerShell (.ps1) files can be imported",
                );
            }

            let scriptContent: string;
            try {
                scriptContent = readFileSync(resolvedPath, "utf8");
            } catch (err) {
                return createActionResultFromError(
                    `Failed to read file: ${err}`,
                );
            }

            if (!scriptContent.trim()) {
                return createActionResultFromError("Script file is empty");
            }

            const overrideName = importParams?.actionName as string | undefined;

            let recipe;
            try {
                const analyzer = new ScriptAnalyzer();
                recipe = await analyzer.analyze(
                    scriptContent,
                    resolvedPath,
                    overrideName,
                );
            } catch (err) {
                return createActionResultFromError(
                    `Failed to analyze script: ${err}`,
                );
            }

            return withFlowMutationLock(recipe.actionName, async () => {
                if (flowStore.hasFlow(recipe.actionName)) {
                    return createActionResultFromError(
                        `A flow named '${recipe.actionName}' already exists. Use a different name: @powershell import ${filePath} with actionName set to a new name`,
                    );
                }

                context.abortSignal?.throwIfAborted();
                await flowStore.saveFlow(recipe, "imported");
                try {
                    context.abortSignal?.throwIfAborted();
                    await context.sessionContext.reloadAgentSchema();
                } catch (error) {
                    await flowStore.deleteFlow(recipe.actionName);
                    throw error;
                }

                const patternList = recipe.grammarPatterns
                    .map((p) => `  "${p.pattern}"`)
                    .join("\n");
                return createActionResultFromTextDisplay(
                    `Imported PowerShell flow '${recipe.actionName}': ${recipe.description}\n\nGrammar patterns:\n${patternList}`,
                );
            });
        }

        default: {
            if (!flowStore) {
                return createActionResultFromError(
                    `Unknown action '${action.actionName}'`,
                );
            }

            const flow = await flowStore.getFlow(action.actionName);
            if (!flow) {
                return createPowerShellFailure(
                    "unknownFlow",
                    `Unknown PowerShell flow '${action.actionName}'. Use 'list PowerShell flows' to see available flows.`,
                );
            }

            const script = await flowStore.getScript(action.actionName);
            if (!script) {
                return createActionResultFromError(
                    `Script not found for flow: ${action.actionName}`,
                );
            }

            const directParams = { ...(action.parameters ?? {}) };
            const validationError = validateFlowParameters(
                directParams,
                flow.parameters,
            );
            if (validationError) {
                return createPowerShellFailure(
                    "invalidParameters",
                    validationError,
                );
            }

            const result = await executeFlowScript(
                flow,
                script,
                directParams,
                context,
                action.actionName,
                flowStore,
            );
            if (result.error !== undefined) {
                return result;
            }

            await recordUsageAfterExecution(
                flowStore,
                action.actionName,
                context,
            );
            return result;
        }
    }
}

let _agentStore: PowerShellStore | undefined;

class ImportScriptHandler implements CommandHandler {
    public readonly description =
        "Import a PowerShell script as a reusable PowerShell flow";
    public readonly parameters = {
        args: {
            filePath: {
                description: "Path to the .ps1 file to import",
                implicitQuotes: true,
            },
        },
        flags: {
            actionName: {
                description: "Override the generated action name",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<PowerShellAgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const store = _agentStore;
        if (!store) {
            throw new Error("Script flow store not available");
        }

        const filePath = params.args.filePath;
        if (!filePath) {
            throw new Error("Missing required argument: filePath");
        }

        const resolvedPath = isAbsolute(filePath)
            ? filePath
            : resolve(process.cwd(), filePath);

        if (!existsSync(resolvedPath)) {
            throw new Error(`File not found: ${resolvedPath}`);
        }

        if (extname(resolvedPath).toLowerCase() !== ".ps1") {
            throw new Error("Only PowerShell (.ps1) files can be imported");
        }

        const scriptContent = readFileSync(resolvedPath, "utf8");
        if (!scriptContent.trim()) {
            throw new Error("Script file is empty");
        }

        const analyzer = new ScriptAnalyzer();
        const overrideName = params.flags.actionName;
        const recipe = await analyzer.analyze(
            scriptContent,
            resolvedPath,
            overrideName,
        );

        if (store.hasFlow(recipe.actionName)) {
            throw new Error(
                `A flow named '${recipe.actionName}' already exists. Delete it first or use --actionName to specify a different name.`,
            );
        }

        await store.saveFlow(recipe, "imported");
        await context.sessionContext.reloadAgentSchema();

        const patternList = recipe.grammarPatterns
            .map((p) => `  "${p.pattern}"`)
            .join("\n");
        context.actionIO.setDisplay(
            `Imported PowerShell flow '${recipe.actionName}': ${recipe.description}\n\nGrammar patterns:\n${patternList}`,
        );
    }
}

class ListHandler implements CommandHandlerNoParams {
    public readonly description = "List all registered PowerShell flows";
    public async run(context: ActionContext<PowerShellAgentContext>) {
        const store = _agentStore;
        if (!store) {
            throw new Error("Script flow store not available");
        }
        const entries = store.listFlows();
        if (entries.length === 0) {
            context.actionIO.setDisplay("No PowerShell flows registered.");
            return;
        }
        const lines = entries.map(
            (e) =>
                `  ${e.actionName}: ${e.description} [usage: ${e.usageCount}]${e.source === "seed" ? " (sample)" : ""}`,
        );
        context.actionIO.setDisplay(
            `Script flows (${entries.length}):\n${lines.join("\n")}`,
        );
    }
}

class RunHandler implements CommandHandler {
    public readonly description = "Execute a PowerShell flow by name";
    public readonly parameters = {
        args: {
            flowName: {
                description: "Name of the PowerShell flow to execute",
            },
        },
        flags: {
            flowParametersJson: {
                description:
                    'JSON string of parameters, e.g. \'{"path":"C:\\\\Users"}\'',
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<PowerShellAgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        if (!isDynamicPowerShellExecutionEnabled()) {
            return createDynamicExecutionDenied();
        }

        const store = _agentStore;
        if (!store) {
            throw new Error("Script flow store not available");
        }

        const flowName = params.args.flowName;
        if (!flowName) {
            throw new Error("Missing required argument: flowName");
        }

        const flow = await store.getFlow(flowName);
        if (!flow) {
            throw new Error(
                `Unknown PowerShell flow '${flowName}'. Use '@powershell list' to see available flows.`,
            );
        }

        const script = await store.getScript(flowName);
        if (!script) {
            throw new Error(`Script not found for flow: ${flowName}`);
        }

        let flowParameters: Record<string, unknown> = {};
        if (params.flags.flowParametersJson) {
            try {
                flowParameters = JSON.parse(params.flags.flowParametersJson);
            } catch {
                throw new Error(
                    `Invalid JSON in --flowParametersJson: ${params.flags.flowParametersJson}`,
                );
            }
        }

        const validationError = validateFlowParameters(
            flowParameters,
            flow.parameters,
        );
        if (validationError) {
            throw new Error(validationError);
        }

        const result = await executeFlowScript(
            flow,
            script,
            flowParameters,
            context,
            flowName,
            store,
        );
        if (result.error !== undefined) {
            throw new Error(String(result.error));
        }

        await store.recordUsage(flowName);
        if ("displayContent" in result && result.displayContent) {
            const content = result.displayContent;
            const text =
                typeof content === "string"
                    ? content
                    : "content" in content
                      ? content.content
                      : String(content);
            context.actionIO.setDisplay(text);
        }
    }
}

class DeleteHandler implements CommandHandler {
    public readonly description = "Delete a PowerShell flow by name";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the PowerShell flow to delete",
            },
        },
    } as const;
    public async run(
        context: ActionContext<PowerShellAgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const store = _agentStore;
        if (!store) {
            throw new Error("Script flow store not available");
        }

        const name = params.args.name;
        if (!name) {
            throw new Error("Missing required argument: name");
        }

        const deleted = await store.deleteFlow(name);
        if (!deleted) {
            throw new Error(`Script flow not found: ${name}`);
        }

        await context.sessionContext.reloadAgentSchema();
        context.actionIO.setDisplay(`Deleted PowerShell flow: ${name}`);
    }
}

class ShowHandler implements CommandHandler {
    public readonly description = "Show details of a PowerShell flow";
    public readonly parameters = {
        args: {
            flowName: {
                description: "Name of the PowerShell flow to show",
            },
        },
    } as const;
    public async run(
        context: ActionContext<PowerShellAgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const store = _agentStore;
        if (!store) {
            throw new Error("Script flow store not available");
        }

        const flowName = params.args.flowName;
        if (!flowName) {
            throw new Error("Missing required argument: flowName");
        }

        const flow = await store.getFlow(flowName);
        if (!flow) {
            throw new Error(
                `Unknown PowerShell flow '${flowName}'. Use '@powershell list' to see available flows.`,
            );
        }

        const script = await store.getScript(flowName);
        const entries = store.listFlows();
        const entry = entries.find((e) => e.actionName === flowName);

        const paramLines = flow.parameters.map(
            (p) =>
                `    ${p.name} (${p.type}${p.required ? ", required" : ""}): ${p.description}${p.default !== undefined ? ` [default: ${p.default}]` : ""}`,
        );
        const grammarLines = flow.grammarPatterns.map(
            (g) => `    "${g.pattern}"${g.isAlias ? " (alias)" : ""}`,
        );
        const snapshot = await store.getExecutionSnapshot(flowName);

        const gates = getPowerShellExecutionGates();
        const executionLines = [
            "Execution: approved local code (NOT sandboxed)",
            `    Availability: ${gates.dynamicExecution.enabled && gates.brokerExecution.enabled ? "enabled" : "disabled by configuration"}`,
            "    Files, network, modules and native programs: current user privileges after authorization",
            `    Approval: ${scriptApprovalStatus(
                {
                    sessionContext: context.sessionContext,
                    definition: {
                        ...flow,
                        requiredModules: getRequiredModules(flow),
                        actionName: flowName,
                    },
                },
                script ?? "",
            )}`,
            `    Stored fingerprint: ${snapshot?.revisionStatus ?? "unavailable"} (not execution approval)`,
            `    Required modules: ${getRequiredModules(flow).join(", ") || "(none)"}`,
            `    Timeout: ${flow.sandbox.maxExecutionTime}s`,
        ];
        const output = [
            `Flow: ${flow.actionName}`,
            `Description: ${flow.description}`,
            `Display Name: ${flow.displayName}`,
            `Source: ${flow.source?.type ?? "unknown"}`,
            `Usage Count: ${entry?.usageCount ?? 0}`,
            "",
            "Parameters:",
            paramLines.length > 0 ? paramLines.join("\n") : "    (none)",
            "",
            "Grammar Patterns:",
            grammarLines.length > 0 ? grammarLines.join("\n") : "    (none)",
            "",
            ...executionLines,
            "",
            "Script:",
            "```powershell",
            script ?? "(script not found)",
            "```",
        ];

        context.actionIO.setDisplay(output.join("\n"));
    }
}

class RevokeApprovalsHandler implements CommandHandlerNoParams {
    public readonly description =
        "Revoke all remembered PowerShell approvals in this session";
    public async run(context: ActionContext<PowerShellAgentContext>) {
        revokeScriptApprovals(context.sessionContext);
        context.actionIO.setDisplay(
            "PowerShell approvals revoked. Subsequent approved-local executions require confirmation.",
        );
    }
}

const handlers: CommandHandlerTable = {
    description: "PowerShell commands",
    commands: {
        list: new ListHandler(),
        run: new RunHandler(),
        delete: new DeleteHandler(),
        show: new ShowHandler(),
        import: new ImportScriptHandler(),
        revoke: new RevokeApprovalsHandler(),
    },
};

// Built-in management actions in the root "powershell" schema. Everything else
// in that schema is a dynamic, user-created flow.
const POWERSHELL_BUILTIN_ACTIONS = new Set([
    "listPowerShellFlows",
    "deletePowerShellFlow",
    "executePowerShellFlow",
    "testPowerShellFlow",
    "createPowerShellFlow",
    "createAndExecutePowerShellFlow",
    "addPowerShellFlowPatterns",
    "reportPowerShellCapabilityOutcome",
    "repairAndExecutePowerShellFlow",
    "editPowerShellFlow",
    "importPowerShellFlow",
]);

export function instantiate(): AppAgent {
    const agentContext: PowerShellAgentContext = {};

    return {
        async initializeAgentContext() {
            return agentContext;
        },
        ...getCommandInterface(handlers),

        async updateAgentContext(
            enable: boolean,
            sessionContext: SessionContext,
        ) {
            if (!enable) {
                closeScriptApprovals(sessionContext);
                return;
            }

            const instanceStorage = sessionContext.instanceStorage;
            if (!instanceStorage) {
                debug("No instance storage available, skipping store init");
                return;
            }

            const store = new PowerShellStore(instanceStorage);
            await store.initialize();
            agentContext.store = store;
            _agentStore = store;

            // Skip sample seeding if TYPEAGENT_NO_SAMPLES env var is set
            if (!process.env.TYPEAGENT_NO_SAMPLES) {
                await seedSampleFlows(store);
            } else {
                debug(
                    "Sample seeding disabled by TYPEAGENT_NO_SAMPLES env var",
                );
            }
            // Dynamic grammar rules are written to grammar/dynamic.agr by the store.
            // The dispatcher reads this file after updateAgentContext completes
            // and registers the rules in its own grammar system.
            debug(`Store initialized with ${store.listFlows().length} flow(s)`);
        },

        async closeAgentContext(context) {
            closeScriptApprovals(context);
        },

        async executeAction(
            action,
            context: ActionContext<PowerShellAgentContext>,
        ) {
            (context as any).__store = agentContext.store;
            try {
                return await handlePowerShellFlowAction(
                    action as PowerShellAction,
                    context,
                );
            } catch (error) {
                if (!(error instanceof PowerShellIntegrityError)) throw error;
                return createPowerShellFailure(
                    "integrityFailure",
                    error.message,
                );
            }
        },

        async validateWildcardMatch(
            action: AppAction,
            _context: SessionContext,
        ): Promise<boolean> {
            // Only dynamic flow actions live in the root "powershell" schema;
            // sub-schema (powershell.powershell-*) static actions and built-in
            // management actions are always valid. A root flow action is valid
            // only if its flow still exists — this rejects stale cached
            // constructions that point to a deleted flow instead of letting them
            // resolve to a now-missing action.
            if (action.schemaName !== "powershell") return true;
            if (POWERSHELL_BUILTIN_ACTIONS.has(action.actionName)) return true;
            const store = agentContext.store;
            if (!store) return true;
            return (await store.getFlow(action.actionName)) !== null;
        },

        async getDynamicSchema(
            _context: SessionContext,
            schemaName: string,
        ): Promise<SchemaContent | undefined> {
            // Only provide dynamic schema for the main powershell schema,
            // not for sub-schemas which use static compiled schemas
            if (schemaName !== "powershell") return undefined;
            if (!agentContext.store) return undefined;
            return {
                format: "ts",
                content: agentContext.store.generateDynamicSchemaText(),
                cacheBinding: await agentContext.store.getActionCacheBinding(),
            };
        },

        async getDynamicGrammar(
            _context: SessionContext,
            schemaName: string,
        ): Promise<GrammarContent | undefined> {
            // Only provide dynamic grammar for the main powershell schema
            if (schemaName !== "powershell") return undefined;
            if (!agentContext.store) return undefined;
            const text = agentContext.store.getDynamicGrammarText();
            if (!text) return undefined;
            return { format: "agr", content: text };
        },
    };
}
