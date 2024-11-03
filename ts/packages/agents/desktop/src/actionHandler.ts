// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAction, SessionContext } from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    disableDesktopActionContext,
    DesktopActionContext,
    runDesktopActions,
    setupDesktopActionContext,
} from "./connector.js";
import { DesktopActions } from "./actionsSchema.js";
export function instantiate() {
    return {
        initializeAgentContext: initializeDesktopContext,
        updateAgentContext: updateDesktopContext,
        executeAction: executeDesktopAction,
    };
}

function initializeDesktopContext(): DesktopActionContext {
    return {
        desktopProcess: undefined,
        programNameIndex: undefined,
        refreshPromise: undefined,
        abortRefresh: undefined,
    };
}

async function updateDesktopContext(
    enable: boolean,
    context: SessionContext<DesktopActionContext>,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        await setupDesktopActionContext(agentContext, context.profileStorage);
    } else {
        await disableDesktopActionContext(agentContext);
    }
}

async function executeDesktopAction(
    action: AppAction,
    context: ActionContext<DesktopActionContext>,
) {
    const message = await runDesktopActions(
        action as DesktopActions,
        context.sessionContext.agentContext,
    );
    return createActionResult(message);
}
