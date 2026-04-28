// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { RequestAction, fromJsonActions } from "agent-cache";
import {
    connectAgentServer,
    ensureAgentServer,
    AgentServerConnection,
} from "@typeagent/agent-server-client";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";

// Default test case, that include multiple phrase action name (out of order) and implicit parameters (context)
const testRequest = new RequestAction(
    "do some player blah",
    fromJsonActions({
        fullActionName: "player.do",
        parameters: {
            value: "blah",
            context: "now",
        },
    }),
);

const CLI_CONVERSATION_NAME = "CLI";

export default class ExplainCommand extends Command {
    static args = {
        request: Args.string({
            description: "Request and action to get an explanation for",
        }),
    };

    static flags = {
        repeat: Flags.integer({
            description: "Number of times to repeat the explanation",
            default: 1,
        }),
        concurrency: Flags.integer({
            description: "Number of concurrent requests",
            default: 5,
        }),
        filter: Flags.string({
            description: "Filter for the explanation",
            options: ["refvalue", "reflist"],
            multiple: true,
            required: false,
        }),
        port: Flags.integer({
            char: "p",
            description: "Port for type agent server",
            default: 8999,
        }),
        show: Flags.boolean({
            description:
                "Start the agent server in a visible window if it is not already running. Default is to start it hidden.",
            default: false,
        }),
        conversation: Flags.string({
            char: "s",
            description:
                "Conversation ID to use. Defaults to the 'CLI' conversation if not specified.",
            required: false,
        }),
    };

    static description = "Explain a request and action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach => play({"ItemType":"song","Artist":"bach"})'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ExplainCommand);

        const command = ["@dispatcher explain"];
        if (flags.filter?.some((f) => f.toLowerCase() === "refvalue")) {
            command.push("--filterValueInRequest");
        }
        if (flags.filter?.some((f) => f.toLowerCase() === "reflist")) {
            command.push("--filterReference");
        }
        if (flags.repeat > 1) {
            command.push(`--repeat ${flags.repeat}`);
            command.push(`--concurrency ${flags.concurrency}`);
        }

        if (args.request) {
            command.push(args.request);
        } else {
            console.log(chalk.yellow("Request not specified, using default."));
            command.push(testRequest.toString());
        }

        const url = `ws://localhost:${flags.port}`;

        await ensureAgentServer(flags.port, !flags.show, 600);
        let connection: AgentServerConnection | undefined;
        try {
            connection = await connectAgentServer(url);

            // Use --conversation directly if provided, otherwise find-or-create the "CLI" conversation
            let conversationId: string;
            if (flags.conversation !== undefined) {
                conversationId = flags.conversation;
            } else {
                const existing = await connection.listConversations(
                    CLI_CONVERSATION_NAME,
                );
                const match = existing.find(
                    (s) =>
                        s.name.toLowerCase() ===
                        CLI_CONVERSATION_NAME.toLowerCase(),
                );
                conversationId =
                    match !== undefined
                        ? match.conversationId
                        : (
                              await connection.createConversation(
                                  CLI_CONVERSATION_NAME,
                              )
                          ).conversationId;
            }

            await withConsoleClientIO(async (clientIO) => {
                const conversation = await connection!.joinConversation(
                    clientIO,
                    {
                        conversationId,
                    },
                );
                await conversation.dispatcher.processCommand(command.join(" "));
            });
        } finally {
            await connection?.close();
        }

        process.exit(0);
    }
}
