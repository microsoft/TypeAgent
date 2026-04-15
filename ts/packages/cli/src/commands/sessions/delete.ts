// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";
import { createInterface } from "readline/promises";

export default class SessionsDelete extends Command {
    static description =
        "Delete a session and its persisted data from the agent server. Usage: sessions delete <id>";
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
            const rl = createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: true,
            });
            const answer = await rl.question(
                `Delete session ${args.id} and all its data? (y/N) `,
            );
            rl.close();
            if (
                answer.toLowerCase() !== "y" &&
                answer.toLowerCase() !== "yes"
            ) {
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
