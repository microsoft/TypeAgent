// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";

export default class ConversationsCreate extends Command {
    static description =
        "Create a new named conversation on the agent server. Defaults to 'CLI' if no name is provided.";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
    };
    static args = {
        name: Args.string({
            description:
                "Human-readable name for the new conversation (default: 'CLI')",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsCreate);
        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            const conversation = await connection.createConversation(
                args.name ?? "CLI",
            );
            this.log(
                `Created conversation '${conversation.name}' (${conversation.conversationId})`,
            );
        } finally {
            await connection.close();
        }
    }
}
