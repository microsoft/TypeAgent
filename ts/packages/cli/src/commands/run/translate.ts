// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    connectAgentServer,
    ensureAgentServer,
    AgentServerConnection,
} from "@typeagent/agent-server-client";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";

const CLI_SESSION_NAME = "CLI";

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
        session: Flags.string({
            char: "s",
            description:
                "Session ID to use. Defaults to the 'CLI' session if not specified.",
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

            // Use --session directly if provided, otherwise find-or-create the "CLI" session
            let sessionId: string;
            if (flags.session !== undefined) {
                sessionId = flags.session;
            } else {
                const existing =
                    await connection.listSessions(CLI_SESSION_NAME);
                const match = existing.find(
                    (s) =>
                        s.name.toLowerCase() === CLI_SESSION_NAME.toLowerCase(),
                );
                sessionId =
                    match !== undefined
                        ? match.sessionId
                        : (await connection.createSession(CLI_SESSION_NAME))
                              .sessionId;
            }

            await withConsoleClientIO(async (clientIO) => {
                const session = await connection!.joinSession(clientIO, {
                    sessionId,
                });
                await session.dispatcher.processCommand(
                    `@dispatcher translate ${args.request}`,
                );
            });
        } finally {
            await connection?.close();
        }

        process.exit(0);
    }
}
