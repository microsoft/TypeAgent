// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { log } from "node:console";
import { CommandHandler, HandlerTable } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { processCommandNoLock } from "../command.js";
import { NotifyCommands } from "./common/interactiveIO.js";

class NotifyInfoCommandHandler implements CommandHandler {
    description: string = "Shows the number of notifications available";
    help?: string;
    public async run(request: string, context: CommandHandlerContext): Promise<void> {
        context.requestIO.notify("showNotifications", context.requestId, NotifyCommands.ShowSummary);
    }
    
}

class NotifyClearCommandHandler implements CommandHandler {
    description: string = "Clears notifications";
    help?: string;
    public async run(request: string, context: CommandHandlerContext): Promise<void> {
        context.requestIO.notify("showNotifications", context.requestId, NotifyCommands.Clear);
    }
    
}

class NotifyShowUnreadCommandHandler implements CommandHandler {
    description: string = "Shows unread notifications";
    help?: string;
    public async run(request: string, context: CommandHandlerContext): Promise<void> {
        context.requestIO.notify("showNotifications", context.requestId, NotifyCommands.ShowUnread);
    }
    
}

class NotifyShowAllCommandHandler implements CommandHandler {
    description: string = "Shows all notifications";
    help?: string;
    public async run(request: string, context: CommandHandlerContext): Promise<void> {
        context.requestIO.notify("showNotifications", context.requestId, NotifyCommands.ShowAll);
    }
    
}

export function getNotifyCommandHandlers(): HandlerTable {
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
                    all: new NotifyShowAllCommandHandler()
                }
            },
        },
    };
}
