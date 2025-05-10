// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
} from "@typeagent/agent-sdk";
import { PlanViewAction } from "./planViewActionSchema.js";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializePlanViewContext,
        updateAgentContext: updatePlanViewContext,
        executeAction: executePlanViewAction,
        validateWildcardMatch: PlanViewValidateWildcardMatch,
    };
}

type PlanViewActionContext = {
    currentFileName: string | undefined;
    viewProcess: ChildProcess | undefined;
};

async function executePlanViewAction(
    action: AppAction,
    context: ActionContext<PlanViewActionContext>,
) {
    let result = await handlePlanViewAction(action as PlanViewAction, context);
    return result;
}

async function PlanViewValidateWildcardMatch(
    action: AppAction,
    context: SessionContext<PlanViewActionContext>,
) {
    return true;
}

async function initializePlanViewContext() {
    return {};
}

async function updatePlanViewContext(
    enable: boolean,
    context: SessionContext<PlanViewActionContext>,
): Promise<void> {
    if (enable) {
        if (!context.agentContext.viewProcess) {
            context.agentContext.viewProcess = await createViewServiceHost();
        }
    } else {
        // shut down service
        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
        }
    }
}

async function handlePlanViewAction(
    action: PlanViewAction,
    actionContext: ActionContext<PlanViewActionContext>,
) {
    let result: ActionResult | undefined = undefined;

    switch (
        action.actionName
        // TODO: Handle plan visualization actions
    ) {
    }

    result = createActionResult("Updated plan");
    return result;
}

export async function createViewServiceHost() {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error("Plan view service creation timed out")),
            10000,
        );
    });

    const viewServicePromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./view/server/server.js"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService);

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Plan view server exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([viewServicePromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
}
