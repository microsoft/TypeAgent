// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared data source for agent/action capability discovery (`@describe` and
// the system.help describe actions — see describeCore.ts) as well as the
// `Dispatcher.getAgentSchemas` RPC surface (dispatcher.ts). Extracted so
// handlers can call it directly without going through the RPC interface.

import type {
    ActionInfo,
    AgentSchemaInfo,
    AgentSubSchemaInfo,
} from "@typeagent/dispatcher-types";
import type { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import {
    generateSchemaTypeDefinition,
    getActionDescription,
} from "@typeagent/action-schema";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";

/** Extract action names + descriptions from a parsed action schema. */
export function extractActions(
    actionSchemas: Map<string, ActionSchemaTypeDefinition>,
): ActionInfo[] {
    const actions: ActionInfo[] = [];
    for (const [name, actionDef] of actionSchemas) {
        actions.push({
            name,
            description: getActionDescription(actionDef) ?? "",
        });
    }
    return actions;
}

export async function getAgentSchemas(
    context: CommandHandlerContext,
    agentName?: string,
    options?: { includeSchemaless?: boolean },
): Promise<AgentSchemaInfo[]> {
    await context.agents.waitUntilReady();
    const configs = context.agents.getActionConfigs();
    // Group configs by top-level agent name (part before the first '.')
    const agentMap = new Map<string, typeof configs>();
    for (const config of configs) {
        const topName = getAppAgentName(config.schemaName);
        if (agentName !== undefined && topName !== agentName) continue;
        const list = agentMap.get(topName) ?? [];
        list.push(config);
        agentMap.set(topName, list);
    }

    const result: AgentSchemaInfo[] = [];
    for (const [name, configList] of agentMap) {
        // Sort: main schema (schemaName === name) first, sub-schemas after
        const sorted = [...configList].sort((a, b) => {
            if (a.schemaName === name) return -1;
            if (b.schemaName === name) return 1;
            return a.schemaName.localeCompare(b.schemaName);
        });

        const subSchemas: AgentSubSchemaInfo[] = [];
        for (const config of sorted) {
            let schemaFile;
            try {
                schemaFile = context.agents.tryGetActionSchemaFile(
                    config.schemaName,
                );
            } catch {
                continue;
            }
            const actions = schemaFile
                ? extractActions(schemaFile.parsedActionSchema.actionSchemas)
                : [];
            if (actions.length === 0) continue;
            const schemaText = schemaFile?.parsedActionSchema.entry.action
                ? generateSchemaTypeDefinition(
                      schemaFile.parsedActionSchema.entry.action,
                  )
                : undefined;
            subSchemas.push({
                schemaName: config.schemaName,
                description: config.description,
                schemaText,
                actions,
            });
        }
        if (subSchemas.length === 0) continue;

        const mainConfig =
            configList.find((c) => c.schemaName === name) ?? configList[0];
        result.push({
            name,
            emoji: mainConfig.emojiChar,
            description: context.agents.getAppAgentDescription(name),
            subSchemas,
        });
    }

    // Optionally include installed agents that expose no action schema (e.g. a
    // greeting/generator agent) as entries with no sub-schemas, so capability
    // discovery can still report them ("no callable actions") instead of
    // "no agent named". Off by default so the getAgentSchemas RPC is unchanged.
    if (options?.includeSchemaless) {
        const present = new Set(result.map((a) => a.name));
        for (const name of context.agents.getAppAgentNames()) {
            if (agentName !== undefined && name !== agentName) continue;
            if (present.has(name)) continue;
            result.push({
                name,
                emoji: context.agents.getAppAgentEmoji(name),
                description: context.agents.getAppAgentDescription(name),
                subSchemas: [],
            });
        }
    }

    return result;
}
