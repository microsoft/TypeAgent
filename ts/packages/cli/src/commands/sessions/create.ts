// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";

export default class SessionsCreate extends Command {
    static description =
        "Create a new named session on the agent server. Defaults to 'CLI' if no name is provided.";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
    };
    static args = {
        name: Args.string({
            description:
                "Human-readable name for the new session (default: 'CLI')",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SessionsCreate);
        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            const session = await connection.createSession(args.name ?? "CLI");
            this.log(
                `Created session '${session.name}' (${session.sessionId})`,
            );
        } finally {
            await connection.close();
        }
    }
}
