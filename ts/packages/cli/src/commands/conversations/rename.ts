// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    connectAgentServer,
    getAgentServerUrl,
} from "@typeagent/agent-server-client";

export default class ConversationsRename extends Command {
    static description =
        "Rename a conversation on the agent server. Usage: conversations rename <id> <newName>";
    static flags = {
        port: Flags.integer({
            description:
                "Override the agent-server port. Defaults to AGENT_SERVER_PORT, then 8999.",
        }),
    };
    static args = {
        id: Args.string({
            description: "Conversation ID to rename",
            required: true,
        }),
        newName: Args.string({
            description: "New name for the conversation",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsRename);
        const url = getAgentServerUrl(flags.port);
        const connection = await connectAgentServer(url);
        try {
            await connection.renameConversation(args.id, args.newName);
            this.log(`Renamed conversation ${args.id} to '${args.newName}'`);
        } finally {
            await connection.close();
        }
    }
}
