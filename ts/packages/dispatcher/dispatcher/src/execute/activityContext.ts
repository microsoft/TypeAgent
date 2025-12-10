// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResultActivityContext, AppAction } from "@typeagent/agent-sdk";
import { getAppAgentName } from "../internal.js";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { DispatcherActivityName } from "../context/dispatcher/dispatcherUtils.js";

function toggleDispatcherActivitySchema(
    context: CommandHandlerContext,
    enable: boolean,
): void {
    context.agents.toggleTransient(DispatcherActivityName, enable);
    // Normally, we will need to clear the translator cache after toggleTransient,
    // but the translator cache is disabled for activity, so just leave the cache as is.
    // TODO: Support translator cache with activity?
    // context.translatorCache.clear();
}

function clearActivityContext(
    context: CommandHandlerContext,
): boolean | undefined {
    const activityContext = context.activityContext;
    if (activityContext === undefined) {
        return undefined;
    }
    const localViewOpened = activityContext.openLocalView;
    context.activityContext = undefined;
    toggleDispatcherActivitySchema(context, false);
    return localViewOpened ? false : undefined;
}

export function toggleActivityContext(
    context: CommandHandlerContext,
    enable: boolean,
) {
    context.session.getConfig().execution.activity = enable;
    if (!enable && context.activityContext !== undefined) {
        setActivityContext(DispatcherActivityName, null, context);
        // REVIEW: clear local view?
        toggleDispatcherActivitySchema(context, false);
    }
}

export function setActivityContext(
    schemaName: string,
    resultActivityContext: ActionResultActivityContext,
    context: CommandHandlerContext,
) {
    // TODO: validate activity context
    if (resultActivityContext === null) {
        // Clear the activity context.
        return clearActivityContext(context);
    }

    const appAgentName = getAppAgentName(schemaName);
    const localViewAction =
        resultActivityContext.openLocalView ??
        (context.activityContext?.appAgentName !== appAgentName
            ? false
            : undefined);

    if (context.session.getConfig().execution.activity) {
        const {
            activityName,
            description,
            state,
            activityEndAction,
            restricted,
        } = resultActivityContext;
        let action: AppAction | undefined;
        if (activityEndAction !== undefined) {
            action = structuredClone(activityEndAction);
            if (action.schemaName === undefined) {
                action.schemaName = schemaName;
            } else if (getAppAgentName(action.schemaName) !== appAgentName) {
                throw new Error(
                    `Action schema name '${action.schemaName}' does not match the activity app agent name '${appAgentName}'.`,
                );
            }
        }

        const activityContext = {
            appAgentName,
            activityName,
            description,
            state,
            openLocalView:
                localViewAction ?? context.activityContext?.openLocalView,
            activityEndAction: action,
            restricted,
        };

        if (context.activityContext === undefined) {
            toggleDispatcherActivitySchema(context, true);
        }

        context.activityContext = activityContext;
    }
    return localViewAction;
}
