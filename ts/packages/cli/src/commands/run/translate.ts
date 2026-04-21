// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    connectAgentServer,
    ensureAgentServer,
    AgentServerConnection,
} from "@typeagent/agent-server-client";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";

const CLI_CONVERSATION_NAME = "CLI";

export default class TranslateCommand extends Command {
    static args = {
        request: Args.string({
            description:
                "Request to translate and get and explanation of the translation",
            required: true,
        }),
    };

    static flags = {
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

    static description = "Translate a request into action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TranslateCommand);
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
                await conversation.dispatcher.processCommand(
                    `@dispatcher translate ${args.request}`,
                );
            });
        } finally {
            await connection?.close();
        }

        process.exit(0);
    }
}
