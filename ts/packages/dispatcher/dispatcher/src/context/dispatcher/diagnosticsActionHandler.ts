// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../commandHandlerContext.js";
import { DispatcherDiagnosticsActions } from "./schema/diagnosticsActionSchema.js";
import { ActionParams } from "../system/action/actionParams.js";

type DiagnosticsCommandHandler = {
    run(
        context: ActionContext<CommandHandlerContext>,
        params:
            | {
                  args?: ActionParams | undefined;
                  flags?: ActionParams | undefined;
              }
            | undefined,
    ): Promise<ActionResult | undefined | void>;
};

export type DiagnosticsCommandHandlers = {
    request: DiagnosticsCommandHandler;
    match: DiagnosticsCommandHandler;
    translate: DiagnosticsCommandHandler;
    reason: DiagnosticsCommandHandler;
    explain: DiagnosticsCommandHandler;
};

export async function executeDispatcherDiagnosticsAction(
    action: TypeAgentAction<DispatcherDiagnosticsActions>,
    context: ActionContext<CommandHandlerContext>,
    handlers: DiagnosticsCommandHandlers,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "dispatchRequest":
            await handlers.request.run(context, {
                args: { request: action.parameters?.request },
                flags: undefined,
            });
            return undefined;
        case "matchDispatcherRequest":
            await handlers.match.run(context, {
                args: { request: action.parameters.request },
                flags: undefined,
            });
            return undefined;
        case "translateDispatcherRequest":
            await handlers.translate.run(context, {
                args: { request: action.parameters.request },
                flags: { history: action.parameters.useHistory ?? false },
            });
            return undefined;
        case "reasonAboutRequest":
            return (
                (await handlers.reason.run(context, {
                    args: { request: action.parameters.request },
                    flags: { engine: action.parameters.engine ?? "" },
                })) ?? undefined
            );
        case "explainDispatcherRequest":
            await handlers.explain.run(context, {
                args: { requestAction: action.parameters.requestAction },
                flags: {
                    repeat: action.parameters.repeat ?? 1,
                    filterValueInRequest:
                        action.parameters.filterValueInRequest ?? false,
                    filterReference: action.parameters.filterReference ?? false,
                    concurrency: action.parameters.concurrency ?? 5,
                },
            });
            return undefined;
    }
}
