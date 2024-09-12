// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppActionWithParameters,
    createTurnImpressionFromLiteral,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    disableDesktopActionContext,
    DesktopActionContext,
    runDesktopActions,
    setupDesktopActionContext,
} from "./connector.js";
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
    action: AppActionWithParameters,
    context: ActionContext<DesktopActionContext>,
) {
    const message = await runDesktopActions(
        action,
        context.sessionContext.agentContext,
    );
    return createTurnImpressionFromLiteral(message);
}
