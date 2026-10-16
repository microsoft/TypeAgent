// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    type CopilotToolMacro,
    type MacroManager,
} from "@typeagent/copilot-macros";
import type { AppAgentProvider } from "agent-dispatcher";
import { createHash, randomUUID } from "node:crypto";
import {
    getMacroActionName,
    getMacroInputSchema,
} from "@typeagent/copilot-macros/macroSchema";
export {
    getMacroActionName,
    getMacroInputSchema,
} from "@typeagent/copilot-macros/macroSchema";

export const macroAgentName = "macros";
const schemaType = "MacroActions";

export function createMacroAppAgentProvider(
    manager: MacroManager,
): AppAgentProvider {
    const sessions = new Set<SessionContext>();
    let unsubscribe: (() => void) | undefined;
    let loadCount = 0;

    async function routableMacros(): Promise<CopilotToolMacro[]> {
        return (await manager.getApprovedMacros()).filter(
            (macro) =>
                !macro.inputs.some((input) => input.secret) &&
                macro.executionKind === "program" &&
                manager.canRunPrograms(),
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
                inputSchema: getMacroInputSchema(macro),
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
        async getDynamicGrammar() {
            const macros = await routableMacros();
            return {
                format: "agr",
                content: macros
                    .flatMap((macro) => macro.learning?.grammarRules ?? [])
                    .join("\n"),
            };
        },
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
                    },
                    {
                        signal: context.abortSignal,
                        requireLatestApproved: true,
                    },
                );
                if (
                    response.status === "failed" ||
                    response.status === "cancelled"
                ) {
                    return {
                        ...createActionResultFromError(
                            `Macro run ${response.run.runId} ${response.run.program?.status ?? response.status}: ${response.run.error?.message ?? "Execution did not complete."} Do not repeat the request; effects may already have occurred.`,
                        ),
                        ...(response.run.program
                            ? { resultValue: response.run.program }
                            : {}),
                    };
                }
                if (response.status !== "completed") {
                    throw new Error("Macro execution did not return a run.");
                }
                return {
                    ...createActionResult(
                        typeof response.run.result === "string"
                            ? response.run.result
                            : JSON.stringify(response.run.result, null, 2),
                    ),
                    resultValue: response.run.result,
                    tokenUsage: programTokenUsage(response.run.program),
                };
            } catch (error) {
                return createActionResultFromError(
                    error instanceof Error ? error.message : String(error),
                );
            }

            function programTokenUsage(
                program:
                    | import("@typeagent/copilot-macros/recipeCore").RecipeRunResult
                    | undefined,
            ) {
                const prompt_tokens =
                    program?.semanticEvidence.reduce(
                        (total, evidence) =>
                            total + (evidence.inputTokens ?? 0),
                        0,
                    ) ?? 0;
                const completion_tokens =
                    program?.semanticEvidence.reduce(
                        (total, evidence) =>
                            total + (evidence.outputTokens ?? 0),
                        0,
                    ) ?? 0;
                return {
                    prompt_tokens,
                    completion_tokens,
                    total_tokens: prompt_tokens + completion_tokens,
                };
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
