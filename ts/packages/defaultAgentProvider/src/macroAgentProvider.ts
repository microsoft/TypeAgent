// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";
import type {
    AppAgent,
    AppAgentManifest,
    SchemaContent,
    SessionContext,
} from "@typeagent/agent-sdk";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    getMacroFeatures,
    type CopilotToolMacro,
    type MacroManager,
} from "@typeagent/copilot-macros";
import type { AppAgentProvider } from "agent-dispatcher";

export const macroAgentName = "macros";
const schemaType = "MacroActions";

export function getMacroActionName(macro: CopilotToolMacro): string {
    return `run_${macro.macroId.replace(/-/g, "_")}_v${macro.version}`;
}

function inputSchema(macro: CopilotToolMacro) {
    return {
        type: "object",
        properties: Object.fromEntries(
            macro.inputs.map((input) => [
                input.name,
                {
                    description: input.description,
                    ...(input.valueType ? { type: input.valueType } : {}),
                },
            ]),
        ),
        required: macro.inputs
            .filter((input) => input.required)
            .map((input) => input.name),
        additionalProperties: false,
    };
}

export function createMacroAppAgentProvider(
    manager: MacroManager,
): AppAgentProvider {
    const sessions = new Set<SessionContext>();
    let unsubscribe: (() => void) | undefined;
    let loadCount = 0;

    async function routableMacros(): Promise<CopilotToolMacro[]> {
        const features = getMacroFeatures();
        return (await manager.getApprovedMacros()).filter(
            (macro) =>
                !macro.inputs.some((input) => input.secret) &&
                (macro.executionClass === "replayable"
                    ? features.replay
                    : features.agentHandoff),
        );
    }

    async function schema(): Promise<SchemaContent> {
        const macros = await routableMacros();
        const tools = [
            {
                name: "listApprovedMacros",
                description:
                    "List approved macros available for natural-language routing.",
                inputSchema: { type: "object", properties: {} },
            },
            ...macros.map((macro) => ({
                name: getMacroActionName(macro),
                description: `Run the entire approved macro '${macro.name}' (version ${macro.version}): ${macro.description}`,
                inputSchema: inputSchema(macro),
            })),
        ];
        return {
            format: "pas",
            content: JSON.stringify(
                toJSONParsedActionSchema(
                    parseToolsJsonSchema(tools, schemaType),
                ),
            ),
            cacheBinding: {
                sourceId: "typeagent:approved-macros",
                actionFingerprints: Object.fromEntries([
                    ["listApprovedMacros", "list-approved-macros-v1"],
                    ...macros.map((macro) => [
                        getMacroActionName(macro),
                        createHash("sha256")
                            .update(JSON.stringify(macro))
                            .digest("hex"),
                    ]),
                ]),
            },
        };
    }

    const agent: AppAgent = {
        async updateAgentContext(enable, context) {
            if (enable) sessions.add(context);
            else sessions.delete(context);
        },
        async closeAgentContext(context) {
            sessions.delete(context);
        },
        getDynamicSchema: async () => schema(),
        async executeAction(action, context) {
            try {
                const macros = await routableMacros();
                if (action.actionName === "listApprovedMacros") {
                    const entries = macros.map((macro) => ({
                        macroId: macro.macroId,
                        version: macro.version,
                        name: macro.name,
                        actionName: getMacroActionName(macro),
                        executionClass: macro.executionClass,
                        inputs: macro.inputs,
                    }));
                    return {
                        ...createActionResult(JSON.stringify(entries, null, 2)),
                        resultValue: entries,
                    };
                }
                const macro = macros.find(
                    (macro) => getMacroActionName(macro) === action.actionName,
                );
                if (!macro) {
                    throw new Error(
                        "This macro route is no longer approved or enabled. Refresh the catalog; do not replay an older route.",
                    );
                }
                const runId = randomUUID();
                const response = await manager.runMacro(
                    {
                        runId,
                        macroId: macro.macroId,
                        version: macro.version,
                        inputs: action.parameters ?? {},
                        preference: "auto",
                    },
                    {
                        signal: context.abortSignal,
                        requireLatestApproved: true,
                    },
                );
                if (response.status === "agentRequired") {
                    return {
                        ...createActionResult(
                            `Macro '${macro.name}' requires the Copilot macro runner. No replay steps were executed.`,
                        ),
                        agentHandoff: {
                            agentName: response.launch.agent,
                            payload: response.launch,
                        },
                        tokenUsage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0,
                        },
                    };
                }
                if (
                    response.status === "failed" ||
                    response.status === "cancelled"
                ) {
                    return createActionResultFromError(
                        `Macro run ${response.run.runId} ${response.status}: ${response.run.error?.message ?? "Replay did not complete."} Do not repeat the request; effects may already have occurred.`,
                    );
                }
                if (response.status !== "completed") {
                    throw new Error("Macro execution did not return a run.");
                }
                return {
                    ...createActionResult(
                        `Macro '${macro.name}' completed (run ${response.run.runId}).\n${JSON.stringify(response.run.result, null, 2)}`,
                    ),
                    resultValue: response.run,
                    tokenUsage: {
                        prompt_tokens: 0,
                        completion_tokens: 0,
                        total_tokens: 0,
                    },
                };
            } catch (error) {
                return createActionResultFromError(
                    error instanceof Error ? error.message : String(error),
                );
            }
        },
    };

    function checkName(name: string): void {
        if (name !== macroAgentName) {
            throw new Error(`Unknown macro agent '${name}'.`);
        }
    }

    return {
        getAppAgentNames: () => [macroAgentName],
        async getAppAgentManifest(name): Promise<AppAgentManifest> {
            checkName(name);
            const schemaContent = await schema();
            return {
                emojiChar: "",
                description: "Approved reusable tool-composed macros",
                schema: {
                    description:
                        "Run approved macros using their typed inputs, or list available macros.",
                    schemaType,
                    schemaFile: schemaContent,
                    ...(schemaContent.cacheBinding
                        ? { cacheBinding: schemaContent.cacheBinding }
                        : {}),
                },
            };
        },
        async loadAppAgent(name) {
            checkName(name);
            if (loadCount++ === 0) {
                unsubscribe = manager.onCatalogChanged(async () => {
                    await Promise.all(
                        [...sessions].map(async (session) => {
                            try {
                                await session.reloadAgentSchema();
                            } catch (error) {
                                session.notify(
                                    AppAgentEvent.Error,
                                    `Macro routes could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
                                );
                                throw error;
                            }
                        }),
                    );
                });
            }
            return agent;
        },
        async unloadAppAgent(name) {
            checkName(name);
            if (loadCount > 0 && --loadCount === 0) {
                unsubscribe?.();
                unsubscribe = undefined;
                sessions.clear();
            }
        },
        isLoaded: (name) => name === macroAgentName && loadCount > 0,
    };
}
