// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    MemoryAction,
    MemoryQuestionParameters,
} from "../schema/memoryActionSchema.js";
import { CommandParams } from "./actionParams.js";

function questionFlags(parameters: MemoryQuestionParameters) {
    return {
        asc: parameters.ascending ?? true,
        message: parameters.displayMessages ?? false,
        knowledge: parameters.displayKnowledge ?? false,
        count: parameters.count ?? 25,
        distinct: parameters.distinct ?? false,
    };
}

export function executeMemoryAction(
    action: TypeAgentAction<MemoryAction, "system.memory">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "setLegacyMemory":
            return executeCommandFromHandlers(
                handlers,
                ["legacy", action.parameters.enabled ? "on" : "off"],
                undefined,
                context,
            );
        case "queryMemory":
            return executeCommandFromHandlers(
                handlers,
                ["query"],
                {
                    args: { terms: action.parameters.terms },
                    flags: {
                        asc: action.parameters.ascending ?? true,
                        message: action.parameters.displayMessages ?? true,
                        knowledge: action.parameters.displayKnowledge ?? true,
                        count: action.parameters.count ?? 25,
                        distinct: action.parameters.distinct ?? false,
                    },
                } as unknown as CommandParams,
                context,
            );
        case "searchMemory":
        case "answerFromMemory":
            return executeCommandFromHandlers(
                handlers,
                [action.actionName === "searchMemory" ? "search" : "answer"],
                {
                    args: { question: action.parameters.question },
                    flags: questionFlags(action.parameters),
                },
                context,
            );
    }
}
