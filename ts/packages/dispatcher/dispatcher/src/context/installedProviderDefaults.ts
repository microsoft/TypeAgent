// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentProvider } from "../agentProvider/agentProvider.js";
import type { CommandHandlerContext } from "./commandHandlerContext.js";

export function persistProviderDisabledDefaults(
    context: CommandHandlerContext,
    provider: AppAgentProvider,
): void {
    const settings = context.session.getSettings();
    const agentNames = new Set(provider.getAppAgentNames());
    const schemas: Record<string, false> = {};
    const actions: Record<string, false> = {};
    const commands: Record<string, false> = {};
    for (const actionConfig of context.agents.getActionConfigs()) {
        const schemaName = actionConfig.schemaName;
        const appAgentName = schemaName.split(".", 1)[0];
        if (!agentNames.has(appAgentName)) {
            continue;
        }
        if (typeof settings.schemas?.[schemaName] !== "boolean") {
            schemas[schemaName] = false;
        }
        if (typeof settings.actions?.[schemaName] !== "boolean") {
            actions[schemaName] = false;
        }
    }
    for (const agentName of agentNames) {
        if (typeof settings.commands?.[agentName] !== "boolean") {
            commands[agentName] = false;
        }
    }
    context.session.updateSettings({ schemas, actions, commands });
}
