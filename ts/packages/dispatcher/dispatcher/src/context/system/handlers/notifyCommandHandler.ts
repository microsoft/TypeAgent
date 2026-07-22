// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    type CommandHandlerContext,
    getRequestId,
} from "../../commandHandlerContext.js";
import { NotifyCommands } from "../../interactiveIO.js";
import {
    ActionContext,
    AppAgentEvent,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import { DispatcherName } from "../../dispatcher/dispatcherUtils.js";

class NotifyInfoCommandHandler implements CommandHandlerNoParams {
    description: string = "Shows the number of notifications available";
    help?: string;
    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.clientIO.notify(
            getRequestId(systemContext),
            "showNotifications",
            NotifyCommands.ShowSummary,
            DispatcherName,
        );
    }
}

class NotifyClearCommandHandler implements CommandHandlerNoParams {
    description: string = "Clears notifications";
    help?: string;
    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.clientIO.notify(
            getRequestId(systemContext),
            "showNotifications",
            NotifyCommands.Clear,
            DispatcherName,
        );
    }
}

class NotifyShowUnreadCommandHandler implements CommandHandlerNoParams {
    description: string = "Shows unread notifications";
    help?: string;
    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.clientIO.notify(
            getRequestId(systemContext),
            "showNotifications",
            NotifyCommands.ShowUnread,
            DispatcherName,
        );
    }
}

class NotifyShowAllCommandHandler implements CommandHandlerNoParams {
    description: string = "Shows all notifications";
    help?: string;

    public async run(
        context: ActionContext<CommandHandlerContext>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        systemContext.clientIO.notify(
            getRequestId(systemContext),
            "showNotifications",
            NotifyCommands.ShowAll,
            DispatcherName,
        );
    }
}

// Mapping from --mode flag values to AppAgentEvent. Bare strings are
// preferred over the enum here so users can type `--mode toast` instead of
// having to know the enum value.
const NOTIFY_TEST_MODES = {
    toast: AppAgentEvent.Toast,
    inline: AppAgentEvent.Inline,
    info: AppAgentEvent.Info,
    warning: AppAgentEvent.Warning,
    error: AppAgentEvent.Error,
} as const;

type NotifyTestMode = keyof typeof NOTIFY_TEST_MODES;

class NotifyTestCommandHandler implements CommandHandler {
    public readonly description =
        "Fire a synthetic notification through the channel — for verifying chat rendering without an agent";
    public readonly parameters = {
        args: {
            message: {
                description: "Notification body text",
                implicitQuotes: true,
            },
        },
        flags: {
            mode: {
                description:
                    "Render mode: toast | inline | info | warning | error",
                default: "toast",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        const mode = params.flags.mode as string;
        const event =
            NOTIFY_TEST_MODES[mode as NotifyTestMode] ?? AppAgentEvent.Toast;
        if (NOTIFY_TEST_MODES[mode as NotifyTestMode] === undefined) {
            context.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `Unknown mode '${mode}', falling back to 'toast'.`,
                    kind: "warning",
                },
                "block",
            );
        }
        // Fire-and-forget. notificationId left undefined so it broadcasts
        // (if running under agent-server) and so dismiss tracking doesn't
        // tie to anything — synthetic notifications can't be dismissed.
        systemContext.clientIO.notify(
            undefined,
            event,
            params.args.message,
            "notify-test",
        );
    }
}

class NotifyStatusTestCommandHandler implements CommandHandler {
    public readonly description =
        "Fire a persistent status notice (a toast that collapses to the notification bell) to verify the chat-ui affordance without a stale server";
    public readonly parameters = {
        args: {
            message: {
                description: "Notice body text",
                implicitQuotes: true,
                optional: true,
            },
        },
        flags: {
            level: {
                description: "Severity accent: info | warning | error",
                default: "warning",
            },
            restart: {
                description:
                    "Include a 'Restart server' action button (runs @server restart when clicked)",
                type: "boolean",
                default: false,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        const levelArg = params.flags.level as string;
        const level = ["info", "warning", "error"].includes(levelArg)
            ? levelArg
            : "warning";
        if (level !== levelArg) {
            context.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `Unknown level '${levelArg}', using 'warning'.`,
                    kind: "warning",
                },
                "block",
            );
        }
        const notice: Record<string, unknown> = {
            id: "notify-test-status",
            level,
            title: "Test status notice",
            message:
                params.args.message ??
                "Dismissing this collapses it to the notification bell; click the bell to re-expand.",
        };
        if (params.flags.restart) {
            notice.actionLabel = "Restart server";
            notice.actionCommand = "@server restart";
        }
        // "statusNotice" is chat-ui's STATUS_NOTICE_EVENT, kept as a literal so
        // the dispatcher needn't depend on the chat-ui (DOM) package. Broadcast
        // (notificationId undefined) so every connected client renders it: the
        // shells show the toast/bell, the CLI prints a yellow line.
        systemContext.clientIO.notify(
            undefined,
            "statusNotice",
            notice,
            "notify-test",
        );
    }
}

export function getNotifyCommandHandlers(): CommandHandlerTable {
    return {
        description: "Notify commands",
        defaultSubCommand: "info",
        commands: {
            info: new NotifyInfoCommandHandler(),
            clear: new NotifyClearCommandHandler(),
            test: new NotifyTestCommandHandler(),
            status: new NotifyStatusTestCommandHandler(),
            show: {
                description: "Show notifications",
                defaultSubCommand: "unread",
                commands: {
                    unread: new NotifyShowUnreadCommandHandler(),
                    all: new NotifyShowAllCommandHandler(),
                },
            },
        },
    };
}
