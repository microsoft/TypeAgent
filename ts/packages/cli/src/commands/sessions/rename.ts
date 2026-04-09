// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";

export default class SessionsRename extends Command {
    static description =
        "Rename a session on the agent server. Usage: sessions rename <id> <newName>";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
    };
    static args = {
        id: Args.string({
            description: "Session ID to rename",
            required: true,
        }),
        newName: Args.string({
            description: "New name for the session",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SessionsRename);
        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            await connection.renameSession(args.id, args.newName);
            this.log(`Renamed session ${args.id} to '${args.newName}'`);
        } finally {
            await connection.close();
        }
    }
}
