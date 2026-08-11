// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, ActionResult } from "@typeagent/agent-sdk";
import type { PowerShellAgentContext } from "../types/powerShellAgentContext.mjs";
import { archivesActionHandler } from "./archives/actionHandler.mjs";
import { dataActionHandler } from "./data/actionHandler.mjs";
import { filesActionHandler } from "./files/actionHandler.mjs";
import { networkActionHandler } from "./network/actionHandler.mjs";
import type {
    PowerShellAction,
    PowerShellNamespaceActionHandler,
} from "./namespaceActionHandler.mjs";
import { processesActionHandler } from "./processes/actionHandler.mjs";
import { servicesActionHandler } from "./services/actionHandler.mjs";
import { systemActionHandler } from "./system/actionHandler.mjs";

const handlers = [
    archivesActionHandler,
    dataActionHandler,
    filesActionHandler,
    networkActionHandler,
    processesActionHandler,
    servicesActionHandler,
    systemActionHandler,
] as const;

const handlersBySchema = new Map<string, PowerShellNamespaceActionHandler>();
for (const handler of handlers) {
    if (handlersBySchema.has(handler.schemaName)) {
        throw new Error(
            `Duplicate PowerShell namespace handler: ${handler.schemaName}`,
        );
    }
    handlersBySchema.set(handler.schemaName, handler);
}

export async function executeNamespaceAction(
    action: PowerShellAction,
    context: ActionContext<PowerShellAgentContext>,
): Promise<ActionResult | undefined> {
    if (!action.schemaName) {
        return undefined;
    }
    return handlersBySchema.get(action.schemaName)?.execute(action, context);
}

export function hasNamespaceAction(
    schemaName: string,
    actionName: string,
): boolean {
    return handlersBySchema.get(schemaName)?.hasAction(actionName) ?? false;
}

export function getRegisteredNamespaceActions(): ReadonlyMap<
    string,
    readonly string[]
> {
    return new Map(
        [...handlersBySchema].map(([schemaName, handler]) => [
            schemaName,
            handler.actionNames,
        ]),
    );
}
