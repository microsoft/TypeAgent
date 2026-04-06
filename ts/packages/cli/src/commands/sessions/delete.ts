// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags, ux } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";

export default class SessionsDelete extends Command {
    static description = "Delete a session and its persisted data from the agent server";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
        yes: Flags.boolean({
            char: "y",
            description: "Skip confirmation prompt",
            default: false,
        }),
    };
    static args = {
        id: Args.string({
            description: "Session ID to delete",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SessionsDelete);

        if (!flags.yes) {
            const confirmed = await ux.confirm(
                `Delete session ${args.id} and all its data? (y/n)`,
            );
            if (!confirmed) {
                this.log("Aborted.");
                return;
            }
        }

        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            await connection.deleteSession(args.id);
            this.log(`Deleted session ${args.id}`);
        } finally {
            await connection.close();
        }
    }
}
