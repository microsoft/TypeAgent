// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, ActionResult } from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { homedir } from "os";
import {
    executeReviewedStaticScript,
    type ScriptParameterRole,
} from "../execution/powershellRunner.mjs";
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

type ActionParameters<
    TAction extends { actionName: string; parameters: Record<string, unknown> },
    TName extends TAction["actionName"],
> = Extract<TAction, { actionName: TName }>["parameters"];

export type StaticPowerShellActionDefinition<
    TParameterName extends string = string,
> = {
    script: string;
    allowedCmdlets: readonly string[];
    allowedPaths?: readonly string[];
    parameterRoles?: Partial<Record<TParameterName, ScriptParameterRole>>;
    allowedModules?: readonly string[];
    networkAccess?: boolean;
    maxExecutionTime?: number;
    confirmation?: string;
};

export type NamespaceActionDefinitions<
    TAction extends {
        actionName: string;
        parameters: Record<string, unknown>;
    },
> = {
    [Name in TAction["actionName"]]: StaticPowerShellActionDefinition<
        Extract<keyof ActionParameters<TAction, Name>, string>
    >;
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
    TAction extends {
        actionName: string;
        parameters: Record<string, unknown>;
    },
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
                let choice: number | undefined;
                try {
                    choice =
                        await context.sessionContext.requestSecurityApproval?.({
                            message: definition.confirmation,
                            choices: ["Run", "Cancel"],
                            defaultId: 1,
                        });
                } catch (error) {
                    context.abortSignal?.throwIfAborted();
                    return createPowerShellFailure(
                        "policyDenied",
                        `Trusted PowerShell authorization is unavailable: ${error instanceof Error ? error.message : String(error)}`,
                        { retryable: false },
                    );
                }
                if (choice !== 0) {
                    return createPowerShellFailure(
                        "policyDenied",
                        "The PowerShell action was not approved.",
                        { retryable: false },
                    );
                }
            }

            const result = await executeReviewedStaticScript({
                script: definition.script,
                parameters: action.parameters ?? {},
                ...(definition.parameterRoles
                    ? { parameterRoles: definition.parameterRoles }
                    : {}),
                sandbox: {
                    allowedCmdlets: [...definition.allowedCmdlets],
                    allowedPaths: [...(definition.allowedPaths ?? [])],
                    allowedModules: [...(definition.allowedModules ?? [])],
                    maxExecutionTime: definition.maxExecutionTime ?? 30,
                    networkAccess: definition.networkAccess ?? false,
                },
                workingDirectory: homedir(),
                abortSignal: context.abortSignal,
                profiler: context.profiler,
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
