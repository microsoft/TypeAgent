// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, ActionResult } from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { homedir } from "os";
import { executeScript } from "../execution/powershellRunner.mjs";
import type { PowerShellAgentContext } from "../types/powerShellAgentContext.mjs";
import {
    createPowerShellExecutionFailure,
    createPowerShellFailure,
} from "../types/powerShellFailure.mjs";

export type PowerShellAction = {
    schemaName?: string;
    actionName: string;
    parameters?: Record<string, unknown>;
};

export type StaticPowerShellActionDefinition = {
    script: string;
    allowedCmdlets: readonly string[];
    allowedPaths?: readonly string[];
    allowedModules?: readonly string[];
    networkAccess?: boolean;
    maxExecutionTime?: number;
    confirmation?: string;
};

export type NamespaceActionDefinitions<TAction extends { actionName: string }> =
    {
        [Name in TAction["actionName"]]: StaticPowerShellActionDefinition;
    };

export interface PowerShellNamespaceActionHandler {
    readonly schemaName: string;
    readonly actionNames: readonly string[];
    hasAction(actionName: string): boolean;
    execute(
        action: PowerShellAction,
        context: ActionContext<PowerShellAgentContext>,
    ): Promise<ActionResult | undefined>;
}

export function createPowerShellNamespaceActionHandler<
    TAction extends { actionName: string },
>(
    schemaName: string,
    definitions: NamespaceActionDefinitions<TAction>,
): PowerShellNamespaceActionHandler {
    const actionDefinitions = definitions as Record<
        string,
        StaticPowerShellActionDefinition
    >;
    const actionNames = Object.freeze(Object.keys(actionDefinitions));

    return {
        schemaName,
        actionNames,
        hasAction(actionName: string): boolean {
            return actionDefinitions[actionName] !== undefined;
        },
        async execute(
            action: PowerShellAction,
            context: ActionContext<PowerShellAgentContext>,
        ): Promise<ActionResult | undefined> {
            if (action.schemaName !== schemaName) {
                return undefined;
            }
            const definition = actionDefinitions[action.actionName];
            if (!definition) {
                return undefined;
            }
            if (definition.confirmation) {
                const choice = await context.sessionContext.popupQuestion(
                    definition.confirmation,
                    ["Run", "Cancel"],
                    1,
                );
                if (choice !== 0) {
                    return createPowerShellFailure(
                        "policyDenied",
                        "The PowerShell action was not approved.",
                        { retryable: false },
                    );
                }
            }

            const result = await executeScript({
                script: definition.script,
                parameters: action.parameters ?? {},
                sandbox: {
                    allowedCmdlets: [...definition.allowedCmdlets],
                    allowedPaths: [...(definition.allowedPaths ?? [])],
                    allowedModules: [...(definition.allowedModules ?? [])],
                    maxExecutionTime: definition.maxExecutionTime ?? 30,
                    networkAccess: definition.networkAccess ?? false,
                },
                workingDirectory: homedir(),
                abortSignal: context.abortSignal,
            });
            if (result.cancelled) {
                context.abortSignal?.throwIfAborted();
            }
            if (!result.success) {
                return createPowerShellExecutionFailure(result);
            }
            return createActionResultFromTextDisplay(
                result.stdout.trim() || "(no output)",
            );
        },
    };
}
