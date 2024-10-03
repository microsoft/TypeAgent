// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerNoParameters,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { NotifyCommands } from "./common/interactiveIO.js";
import { ActionContext } from "@typeagent/agent-sdk";

class NotifyInfoCommandHandler implements CommandHandlerNoParameters {
    description: string = "Shows the number of notifications available";
    help?: string;
    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.requestIO.notify(
            "showNotifications",
            systemContext.requestId,
            NotifyCommands.ShowSummary,
        );
    }
}

class NotifyClearCommandHandler implements CommandHandlerNoParameters {
    description: string = "Clears notifications";
    help?: string;
    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.requestIO.notify(
            "showNotifications",
            systemContext.requestId,
            NotifyCommands.Clear,
        );
    }
}

class NotifyShowUnreadCommandHandler implements CommandHandlerNoParameters {
    description: string = "Shows unread notifications";
    help?: string;
    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.requestIO.notify(
            "showNotifications",
            systemContext.requestId,
            NotifyCommands.ShowUnread,
        );
    }
}

class NotifyShowAllCommandHandler implements CommandHandlerNoParameters {
    description: string = "Shows all notifications";
    help?: string;

    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.requestIO.notify(
            "showNotifications",
            systemContext.requestId,
            NotifyCommands.ShowAll,
        );
    }
}

export function getNotifyCommandHandlers(): CommandHandlerTable {
    return {
        description: "Notify commands",
        defaultSubCommand: new NotifyInfoCommandHandler(),
        commands: {
            info: new NotifyInfoCommandHandler(),
            clear: new NotifyClearCommandHandler(),
            show: {
                description: "Show notifications",
                defaultSubCommand: new NotifyShowUnreadCommandHandler(),
                commands: {
                    unread: new NotifyShowUnreadCommandHandler(),
                    all: new NotifyShowAllCommandHandler(),
                },
            },
        },
    };
}
